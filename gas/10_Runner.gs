/**
 * 10_Runner.gs
 * ------------------------------------------------------------------
 * 実行の司令塔。トリガーから呼ばれるのはこのファイルの関数だけ。
 *
 * 【GASの6分制限への対策】
 * 収集を「法人・ソース別の小さなジョブ」に分割し、進捗をスクリプト
 * プロパティに保存する。1回の実行では MAX_RUNTIME_MS（既定4分30秒）
 * までしか働かず、終わらなければ1分後に自分を呼ぶ使い捨てトリガーを
 * 作って中断する。次の実行は続きから再開する。
 *
 * 【多重実行の防止】
 * すべての入口で LockService を使う。ロックが取れなければ
 * 「別の実行が動いている」とみなして即座に終了する（待たない）。
 *
 * 【失敗時】
 * ジョブ単位で例外を受け止め、RUN_LOG に残して次のジョブへ進む。
 * 1回の収集が終わった時点でエラーがあれば管理者へまとめて通知する。
 * ------------------------------------------------------------------
 */

var RUN_STATE_PROP_ = 'RUN_STATE';
var CONTINUATION_HANDLER_ = 'runCollectStep';

// ------------------------------------------------------------------
// 収集
// ------------------------------------------------------------------

/**
 * 日次収集の開始。毎日03:00のトリガーから呼ばれる。
 * 手動で「今すぐ収集する」を押したときもここから始まる。
 */
function startDailyCollection() {
  var started = runWithScriptLock_(1000, function () {
    deleteContinuationTriggers_();

    var offset = cfgNum_('REPORT_TARGET_OFFSET_DAYS', 1);
    var range = targetDateRange_(offset);
    var jobs = buildJobList_(offset);

    var state = {
      startedAt: new Date().toISOString(),
      targetLabel: range.label,
      offsetDays: offset,
      jobs: jobs,
      cursor: 0,
      added: { mail: 0, talk: 0, line: 0 },
      errors: []
    };
    saveRunState_(state);
    logRun_('collect:start', 'OK', jobs.length, 0, '対象日 ' + range.label + ' / ジョブ ' + jobs.length + '件');
  });

  if (!started) {
    logRun_('collect:start', 'SKIP', 0, 0, '別の実行が動いているため開始しませんでした。');
    return;
  }
  runCollectStep();
}

/** 実行するジョブの一覧を作る（ソース別・法人別に分割） */
function buildJobList_(offsetDays) {
  var jobs = [{ type: 'line_flush', label: 'LINE退避分の書き出し' }];

  if (cfgBool_('ENABLE_GMAIL', true)) {
    getMailTargets_().forEach(function (t) {
      jobs.push({ type: 'gmail', label: 'Gmail: ' + t.email, target: t, offsetDays: offsetDays });
    });
  }
  if (cfgBool_('ENABLE_LINEWORKS', true)) {
    var lag = cfgNum_('LW_MONITORING_LAG_DAYS', 0);
    jobs.push({ type: 'lineworks', label: 'LINE WORKSモニタリング', offsetDays: offsetDays + lag });
  }
  if (cfgBool_('ENABLE_LINE_OA', true)) {
    jobs.push({ type: 'line_enrich', label: 'LINE顧客名の補完' });
  }
  return jobs;
}

/**
 * ジョブを時間の許す限り実行する。
 * 使い捨てトリガーからも、startDailyCollection からも呼ばれる。
 */
function runCollectStep() {
  var deadline = Date.now() + cfgNum_('MAX_RUNTIME_MS', 270000);
  var budget = { deadline: deadline };

  var ran = runWithScriptLock_(1000, function () {
    try {
      var state = loadRunState_();
      if (!state) {
        logRun_('collect:step', 'SKIP', 0, 0, '実行中の収集がありません。');
        return;
      }

      while (state.cursor < state.jobs.length && Date.now() < deadline) {
        var job = state.jobs[state.cursor];
        var started = Date.now();
        try {
          var result = runSingleJob_(job, budget);
          logRun_(job.type, 'OK', result.added || 0, Date.now() - started,
            job.label + ' / 取得 ' + (result.scanned || 0) + '件 → 追記 ' + (result.added || 0) + '件');
          accumulate_(state.added, job.type, result.added || 0);
        } catch (err) {
          logRun_(job.type, 'ERROR', 0, Date.now() - started, job.label + ' / ' + err);
          state.errors.push(job.label + ': ' + String(err).slice(0, 200));
        }
        state.cursor++;
        saveRunState_(state);
      }

      if (state.cursor < state.jobs.length) {
        // 続きがある。1分後に自分を呼ぶ使い捨てトリガーを作って中断する
        scheduleContinuation_();
        logRun_('collect:step', 'OK', state.cursor, 0,
          '実行時間の上限のため中断しました。残り ' + (state.jobs.length - state.cursor) + 'ジョブ。1分後に再開します。');
        return;
      }

      finishCollection_(state);
    } catch (fatal) {
      logRun_('collect:step', 'ERROR', 0, 0, '致命的エラー: ' + fatal);
      notifyAdmin_('収集処理が異常終了しました', String(fatal));
    }
  });

  if (!ran) {
    logRun_('collect:step', 'SKIP', 0, 0, '別の実行が動いているため見送りました。');
  }
}

/** 1ジョブを実行する */
function runSingleJob_(job, budget) {
  switch (job.type) {
    case 'line_flush':
      return { added: flushLineQueue(), scanned: 0 };
    case 'gmail':
      return collectGmailForTarget_(job.target, targetDateRange_(job.offsetDays), budget);
    case 'lineworks':
      return collectLineWorksTalks_(targetDateRange_(job.offsetDays), budget);
    case 'line_enrich':
      return { added: enrichLineProfiles_(budget), scanned: 0 };
    default:
      throw new Error('未知のジョブ種別: ' + job.type);
  }
}

function accumulate_(added, jobType, n) {
  if (jobType === 'gmail') added.mail += n;
  else if (jobType === 'lineworks') added.talk += n;
  else added.line += n;
}

/** 収集完了の後始末 */
function finishCollection_(state) {
  deleteContinuationTriggers_();
  clearRunState_();
  rotateRunLog_();

  var summary = 'メール ' + state.added.mail + '件 / トーク ' + state.added.talk + '件 / LINE ' + state.added.line + '件';
  logRun_('collect:done', state.errors.length ? 'ERROR' : 'OK',
    state.added.mail + state.added.talk + state.added.line, 0,
    summary + (state.errors.length ? ' / エラー' + state.errors.length + '件' : ''));

  if (state.errors.length) {
    notifyAdmin_('収集中に ' + state.errors.length + ' 件のエラーがありました',
      '対象日: ' + state.targetLabel + '\n\n' + state.errors.join('\n') + '\n\n詳細はRUN_LOGシートを確認してください。');
  }
}

// ------------------------------------------------------------------
// 日次AI報告
// ------------------------------------------------------------------

/**
 * 日次報告の生成と送信。毎日06:00のトリガーから呼ばれる。
 */
function runDailyReport() {
  return executeDailyReport_(true);
}

/**
 * 送信せずに報告だけ作る（試験運用・レビュー用）。
 * @return {string} 生成された報告本文
 */
function generateDailyReportWithoutSending() {
  return executeDailyReport_(false);
}

function executeDailyReport_(send) {
  var started = Date.now();
  var report = '';
  var failure = null;

  var ran = runWithScriptLock_(1000, function () {
    try {
      var range = targetDateRange_(cfgNum_('REPORT_TARGET_OFFSET_DAYS', 1));
      var data = gatherReportData_(range);
      var prompt = buildReportPrompt_(data);
      var aiText = callGemini_(prompt);
      report = composeReportText_(data, aiText);

      var sendResult = '未送信（試作）';
      if (send) {
        try {
          sendResult = notifyPresident_(report);
        } catch (e) {
          sendResult = '送信失敗: ' + e;
          notifyAdmin_('日次報告の送信に失敗しました', String(e) + '\n\n報告本文はREPORT_LOGシートに保存済みです。');
        }
      }

      logReport_(range.label, cfg_('GEMINI_MODEL', ''), prompt.length, report, sendResult);
      logRun_('report', 'OK', 1, Date.now() - started, range.label + ' / ' + sendResult);
    } catch (err) {
      logRun_('report', 'ERROR', 0, Date.now() - started, String(err));
      notifyAdmin_('日次報告の生成に失敗しました', String(err));
      failure = err;
    }
  });

  if (!ran) {
    logRun_('report', 'SKIP', 0, 0, '別の実行が動いているため見送りました。');
    return '';
  }
  if (failure) throw failure;
  return report;
}

// ------------------------------------------------------------------
// 進捗状態と使い捨てトリガー
// ------------------------------------------------------------------

/**
 * 進捗を保存する。
 * スクリプトプロパティは1件あたり約9KBの制限があるため、
 * あふれそうな場合はエラー履歴を間引く（進捗そのものは必ず残す）。
 */
function saveRunState_(state) {
  var json = JSON.stringify(state);
  if (json.length > 8000) {
    state.errors = state.errors.slice(-5);
    json = JSON.stringify(state);
  }
  if (json.length > 8000) {
    // それでも大きい場合はジョブの表示名を削る（処理には影響しない）
    state.jobs.forEach(function (j) { j.label = j.type; });
    json = JSON.stringify(state);
  }
  scriptProps_().setProperty(RUN_STATE_PROP_, json);
}

function loadRunState_() {
  var raw = scriptProps_().getProperty(RUN_STATE_PROP_);
  return raw ? JSON.parse(raw) : null;
}

function clearRunState_() {
  scriptProps_().deleteProperty(RUN_STATE_PROP_);
}

/** 途中で止まった収集を手動でリセットする（詰まったときの復旧用） */
function resetCollectionState() {
  clearRunState_();
  deleteContinuationTriggers_();
  logRun_('collect:reset', 'OK', 0, 0, '進捗状態を手動でリセットしました。');
}

/** 1分後に runCollectStep を呼ぶ使い捨てトリガーを作る */
function scheduleContinuation_() {
  deleteContinuationTriggers_();
  ScriptApp.newTrigger(CONTINUATION_HANDLER_)
    .timeBased()
    .after(60 * 1000)
    .create();
}

/** 使い捨てトリガーを掃除する（放置するとトリガー数の上限に当たる） */
function deleteContinuationTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === CONTINUATION_HANDLER_
      && t.getEventType() === ScriptApp.EventType.CLOCK) {
      // 定期トリガーではなく after() で作った使い捨てのみを消す
      ScriptApp.deleteTrigger(t);
    }
  });
}
