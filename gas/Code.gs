/**
 * Code.gs
 * メインエントリーポイント
 *
 * 【エントリーポイント一覧】
 * - scheduledMain() : トリガーから10分ごとに呼ばれる（平日の8/13/16時台だけ処理）
 * - manualRun()     : 手動テスト用（時間帯チェックなし）
 */

/**
 * 10分ごとのトリガーから呼ばれるメイン関数
 * 平日の 8・13・16 時台にだけ実処理を行う
 */
function scheduledMain() {
  // LockService で二重実行を防止（他のインスタンスが実行中なら即スキップ）
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    Logger.log('別の実行が進行中のためスキップ');
    return;
  }

  try {
    const now = new Date();
    const jstHour = parseInt(Utilities.formatDate(now, 'Asia/Tokyo', 'HH'), 10);

    // 平日チェック（GAS のタイムゾーンが JST に設定済みの前提）
    if (!isWeekday_(now)) {
      // 土日は大量にログが出るので記録しない
      return;
    }

    // 対象時間帯チェック
    if (!RUN_HOURS.includes(jstHour)) {
      return;
    }

    // 同じ日・同じ時間帯での二重実行防止
    const slotKey = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMdd_HH');
    const config = getConfig();

    if (config.lastRunSlot === slotKey) {
      Logger.log(`スロット ${slotKey} は実行済みのためスキップ`);
      return;
    }

    Logger.log(`===== メール処理開始: ${slotKey} =====`);

    // 実行スロットを即座に記録（処理中に別インスタンスが起動した場合の防止）
    updateLastRunSlot(slotKey);

    processInfoMails_();

  } catch (e) {
    Logger.log(`scheduledMain エラー: ${e.message}`);
    Logger.log(e.stack);
  } finally {
    lock.releaseLock();
  }
}

/**
 * 手動テスト用関数（時間帯・曜日チェックをバイパスして実行）
 * Apps Script エディタまたはトリガーから手動実行する
 */
function manualRun() {
  Logger.log('===== 手動実行開始 =====');
  processInfoMails_();
  Logger.log('===== 手動実行終了 =====');
}

/**
 * メール処理のコア処理
 */
function processInfoMails_() {
  const config = getConfig();

  // 設定バリデーション
  const errors = validateConfig(config);
  if (errors.length > 0) {
    Logger.log('設定エラーのため処理を中止します:');
    errors.forEach(e => Logger.log(`  - ${e}`));
    return;
  }

  if (config.isDryRun) {
    Logger.log('🔵 DRY_RUN モード: 下書き作成・LINE WORKS 通知は行いません');
  }

  // スプレッドシート取得
  let ss;
  try {
    ss = getSpreadsheet(config.spreadsheetId);
  } catch (e) {
    Logger.log(`❌ スプレッドシート取得失敗: ${e.message}`);
    return;
  }

  // 処理済みメッセージIDを取得（二重処理防止）
  const processedIds = getProcessedMessageIds(ss);
  Logger.log(`処理済みメッセージ数: ${processedIds.size}`);

  // 新着メール検索
  let newMessages;
  try {
    newMessages = searchNewEmails(config, processedIds, config.lastSuccessMs);
  } catch (e) {
    Logger.log(`❌ メール検索失敗: ${e.message}`);
    return;
  }

  if (newMessages.length === 0) {
    Logger.log('新着メールなし');
    sendNotificationSafely_(config, ss, [], 0);
    updateLastSuccessMs(Date.now());
    return;
  }

  Logger.log(`処理対象: ${newMessages.length}件`);

  const createdTasks = [];
  let successCount = 0;
  let errorCount = 0;

  for (const message of newMessages) {
    try {
      const task = processOneEmail_(message, config, ss);
      if (task) createdTasks.push(task);
      successCount++;
    } catch (e) {
      errorCount++;
      Logger.log(`メール処理エラー [${message.getId()}]: ${e.message}`);
      // 1件のエラーで全体を止めない。ログには記録済み（processOneEmail_ 内）
    }
  }

  Logger.log(`処理完了: 成功${successCount}件 / エラー${errorCount}件`);
  Logger.log(`タスク登録: ${createdTasks.length}件`);

  // LINE WORKS 通知
  sendNotificationSafely_(config, ss, createdTasks, newMessages.length);

  // エラーがゼロ、またはエラーより成功が多ければ成功時刻を更新
  if (errorCount === 0 || successCount >= errorCount) {
    updateLastSuccessMs(Date.now());
    Logger.log('LAST_SUCCESS_MS を更新しました');
  }
}

/**
 * メール1件を処理する（AI 判定 → 下書き作成 → シート登録 → ログ記録）
 * @param {GmailMessage} message
 * @param {Object} config
 * @param {Spreadsheet} ss
 * @returns {Object|null} タスク情報（対応不要の場合は null）
 */
function processOneEmail_(message, config, ss) {
  const emailInfo = extractEmailInfo(message);
  Logger.log(`処理中: 「${emailInfo.subject}」from: ${emailInfo.from}`);

  // AI 判定
  let aiResult;
  try {
    aiResult = analyzeEmailWithGemini(emailInfo, config.geminiApiKey);
    Logger.log(`AI判定: 対応=${aiResult.requires_response} / 優先度=${aiResult.priority} / カテゴリ=${aiResult.category}`);
  } catch (e) {
    recordLog(ss, {
      result: 'AI_ERROR',
      messageId: emailInfo.messageId,
      threadId: emailInfo.threadId,
      receivedAt: emailInfo.date,
      sender: emailInfo.from,
      subject: emailInfo.subject,
      note: 'Gemini API 呼び出しエラー',
      errorDetail: e.message
    });
    throw e;
  }

  // 対応不要の場合はログだけ記録してスキップ
  if (!aiResult.requires_response) {
    recordLog(ss, {
      result: 'SKIPPED',
      messageId: emailInfo.messageId,
      threadId: emailInfo.threadId,
      receivedAt: emailInfo.date,
      sender: emailInfo.from,
      subject: emailInfo.subject,
      aiRequiresResponse: false,
      priority: aiResult.priority,
      category: aiResult.category,
      note: aiResult.reason
    });
    Logger.log('  → 対応不要としてスキップ');
    return null;
  }

  // Gmail 下書き作成
  let draftId;
  try {
    draftId = createDraftReply(message, aiResult.reply_draft, config.isDryRun);
  } catch (e) {
    Logger.log(`下書き作成失敗（処理は継続）: ${e.message}`);
    draftId = 'DRAFT_ERROR';
  }

  // スプレッドシートにタスク登録
  let rowUrl;
  try {
    rowUrl = registerTask(ss, emailInfo, aiResult, draftId);
    Logger.log(`  → タスク登録: ${rowUrl}`);
  } catch (e) {
    // シート書き込み失敗でも、ログには記録する
    recordLog(ss, {
      result: 'SHEET_ERROR',
      messageId: emailInfo.messageId,
      threadId: emailInfo.threadId,
      receivedAt: emailInfo.date,
      sender: emailInfo.from,
      subject: emailInfo.subject,
      aiRequiresResponse: true,
      priority: aiResult.priority,
      category: aiResult.category,
      note: 'スプレッドシート書き込みエラー',
      errorDetail: e.message
    });
    throw e;
  }

  // 処理ログに成功を記録
  recordLog(ss, {
    result: 'TASK_CREATED',
    messageId: emailInfo.messageId,
    threadId: emailInfo.threadId,
    receivedAt: emailInfo.date,
    sender: emailInfo.from,
    subject: emailInfo.subject,
    aiRequiresResponse: true,
    priority: aiResult.priority,
    category: aiResult.category,
    note: rowUrl || 'URL取得失敗'
  });

  // LINE WORKS 通知用のタスク情報を返す
  return {
    priority: aiResult.priority,
    subject: emailInfo.subject,
    sender: emailInfo.from,
    summary: aiResult.summary,
    task: aiResult.task,
    assigneeHint: aiResult.assignee_hint,
    dueHint: aiResult.due_hint,
    draftId: draftId,
    rowUrl: rowUrl
  };
}

/**
 * LINE WORKS 通知をエラーが出ても止まらずに送信する
 * @param {Object} config
 * @param {Spreadsheet} ss
 * @param {Object[]} tasks
 * @param {number} checkedCount
 */
function sendNotificationSafely_(config, ss, tasks, checkedCount) {
  try {
    sendLineWorksNotification(config.lineWorksWebhookUrl, tasks, checkedCount, config.isDryRun);
  } catch (e) {
    Logger.log(`LINE WORKS 通知エラー: ${e.message}`);
    try {
      recordLog(ss, {
        result: 'NOTIFICATION_ERROR',
        note: 'LINE WORKS 通知送信エラー',
        errorDetail: e.message
      });
    } catch (logErr) {
      Logger.log(`通知エラーのログ記録も失敗: ${logErr.message}`);
    }
  }
}

/**
 * 平日かどうかを JST で判定する
 * @param {Date} date
 * @returns {boolean}
 */
function isWeekday_(date) {
  // Utilities.formatDate でタイムゾーンを明示して曜日を取得
  // 'u' フォーマット: 1=月曜 〜 5=金曜, 6=土曜, 7=日曜
  const dow = parseInt(Utilities.formatDate(date, 'Asia/Tokyo', 'u'), 10);
  return dow >= 1 && dow <= 5;
}
