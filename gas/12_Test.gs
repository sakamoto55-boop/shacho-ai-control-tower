/**
 * 12_Test.gs
 * ------------------------------------------------------------------
 * 動作確認用のテスト関数。CHECKLIST.md と対応している。
 *
 * 外部への送信を伴うものと、伴わないものを明確に分けてある。
 *   testAll()            … 送信なし。まずこれを実行する
 *   testNotifyAdmin()    … 管理者へ1通送る（社内）
 *   testNotifyPresident()… 経営者へ1通送る（社内）
 *
 * サンプルデータはメッセージIDが SAMPLE- で始まる行として入り、
 * testClearSampleData() でまとめて消せる。
 * ------------------------------------------------------------------
 */

var SAMPLE_PREFIX_ = 'SAMPLE-';

function assert_(condition, message) {
  if (!condition) throw new Error('テスト失敗: ' + message);
  Logger.log('  OK: ' + message);
}

/**
 * 送信を伴わないテストを一括実行する。
 * 実行後は「実行ログ」で結果を確認する。
 */
function testAll() {
  var results = [];
  var tests = [
    ['設定の読み込み', testConfig],
    ['マスキング', testMasking],
    ['日付の扱い', testDateRange],
    ['CSV列の特定', testCsvColumnMatching],
    ['通知の分割', testNotifySplit],
    ['プロンプト組み立て', testBuildPrompt]
  ];
  tests.forEach(function (t) {
    try {
      Logger.log('--- ' + t[0] + ' ---');
      t[1]();
      results.push('○ ' + t[0]);
    } catch (e) {
      Logger.log('  NG: ' + e);
      results.push('× ' + t[0] + ' … ' + e);
    }
  });
  var text = results.join('\n');
  Logger.log('\n===== テスト結果 =====\n' + text);
  try {
    SpreadsheetApp.getUi().alert('動作テスト結果（送信なし）', text, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) { /* エディタから実行した場合 */ }
  return text;
}

// ------------------------------------------------------------------
// 個別テスト（送信なし・API接続なし）
// ------------------------------------------------------------------

/** CONFIGシートと各設定シートが読めるか */
function testConfig() {
  clearConfigCache_();
  clearMaskRulesCache_();
  assert_(timezone_() !== '', 'TIMEZONEが読める（' + timezone_() + '）');
  assert_(cfgNum_('MAX_RUNTIME_MS', 0) > 0, 'MAX_RUNTIME_MSが数値として読める');
  assert_(cfgBool_('ENABLE_GMAIL', false) === true || cfgBool_('ENABLE_GMAIL', false) === false, 'ENABLE_GMAILが真偽値として読める');
  var orgs = getOrganizations_();
  assert_(orgs.length > 0, 'CONFIG_ORGに有効な法人が ' + orgs.length + ' 件ある');
  var segments = getSegments_();
  assert_(segments.length > 0, '事業区分: ' + segments.join(' / '));
  var targets = getMailTargets_();
  Logger.log('  情報: Gmail収集対象は ' + targets.length + ' アドレス（有効=TRUEの行）');
  var rules = getMaskRules_();
  assert_(rules.length > 0, 'CONFIG_MASKに有効なルールが ' + rules.length + ' 件ある');
}

/** マスキングが効いているか */
function testMasking() {
  clearMaskRulesCache_();
  var sample = [
    '担当の携帯は 090-1234-5678 です。折り返しお願いします。',
    '振込先は 普通 1234567 、連絡先 taro@example.com まで。',
    '〒123-4567 の現場です。至急対応をお願いします。'
  ].join('\n');

  var masked = maskForAi_(sample);
  Logger.log('  マスキング前: ' + sample);
  Logger.log('  マスキング後: ' + masked);

  assert_(masked.indexOf('090-1234-5678') < 0, '電話番号が伏せ字になる');
  assert_(masked.indexOf('taro@example.com') < 0, 'メールアドレスが伏せ字になる');
  assert_(masked.indexOf('123-4567') < 0, '郵便番号が伏せ字になる');
  assert_(masked.indexOf('至急対応') >= 0, '業務上必要な語は残る');

  // 経営データは正規表現ルールを当てない（数値を壊さない）
  var bizSample = '解体事業部\t売上\t12,345,678';
  assert_(maskBusinessText_(bizSample).indexOf('12,345,678') >= 0, '経営データの数値は伏せ字にならない');
}

/** 対象日の計算が意図どおりか */
function testDateRange() {
  var r = targetDateRange_(1);
  Logger.log('  前日の範囲: ' + formatDateTime_(r.start) + ' 〜 ' + formatDateTime_(r.end));
  assert_(r.end.getTime() - r.start.getTime() === 86400000, '1日ぶんの長さになっている');
  assert_(formatDateTime_(r.start).indexOf('00:00:00') > 0, '0時00分から始まっている');
  assert_(r.label === formatDate_(r.start), 'ラベルが対象日と一致する');
}

/** モニタリングCSVの列名マッチング */
function testCsvColumnMatching() {
  var header = ['送信日時', 'トークルーム', '送信者', '送信者アカウント', '本文', 'メッセージID'];
  assert_(findColumnIndex_(header, cfgList_('LW_CSV_COL_DATETIME')) === 0, '日時列を特定できる');
  assert_(findColumnIndex_(header, cfgList_('LW_CSV_COL_TEXT')) === 4, '本文列を特定できる');
  assert_(findColumnIndex_(header, ['存在しない列']) === -1, '無い列は-1が返る');

  var d = parseLooseDate_('2026-08-05 09:12:34');
  assert_(d && !isNaN(d.getTime()), '日時文字列をDateに変換できる');
  assert_(parseLooseDate_('') === null, '空文字はnullになる');
}

/** 長文の分割送信 */
function testNotifySplit() {
  var line = 'これはテスト行です。\n';
  var long = '';
  while (long.length < 5000) long += line;
  var chunks = splitForNotify_(long);
  assert_(chunks.length > 1, '長文が ' + chunks.length + ' 通に分割される');
  var size = cfgNum_('NOTIFY_CHUNK_SIZE', 1800);
  assert_(chunks.every(function (c) { return c.length <= size; }), '各通が上限文字数以内である');
  assert_(splitForNotify_('短い文').length === 1, '短文は分割されない');
}

/**
 * プロンプトの組み立て。APIは呼ばない。
 * サンプルデータを入れてから実行すると内容を確認しやすい。
 */
function testBuildPrompt() {
  var range = targetDateRange_(cfgNum_('REPORT_TARGET_OFFSET_DAYS', 1));
  var data = gatherReportData_(range);
  var prompt = buildReportPrompt_(data);
  Logger.log('  対象日: ' + data.dateLabel);
  Logger.log('  件数: メール' + data.counts.mailTotal + ' / トーク' + data.counts.talkTotal + ' / LINE' + data.counts.lineTotal);
  Logger.log('  プロンプト長: ' + prompt.length + ' 文字');
  Logger.log('----- プロンプト（先頭2000文字）-----\n' + prompt.slice(0, 2000));

  assert_(prompt.length > 0, 'プロンプトが生成される');
  assert_(prompt.indexOf('数値の計算・推定・按分をしてはいけません') > 0, '数値を計算させない指示が入っている');
  assert_(prompt.indexOf('@') < 0 || prompt.indexOf('【メールアドレス】') > 0, '生のメールアドレスが残っていない');
  return prompt;
}

// ------------------------------------------------------------------
// 接続テスト（外部APIを呼ぶ。社外への送信はしない）
// ------------------------------------------------------------------

/** Gmailの認証と読み取りが通るか。1アドレス・1件だけ試す */
function testGoogleAuth() {
  var targets = getMailTargets_();
  assert_(targets.length > 0, 'CONFIG_MAIL_TARGETに有効なアドレスがある');
  var target = targets[0];
  Logger.log('  対象: ' + target.email);

  var token = getGoogleAccessToken_(target.email);
  assert_(token && token.length > 20, 'アクセストークンを取得できた');

  var res = fetchJson_(
    'https://gmail.googleapis.com/gmail/v1/users/me/profile',
    { method: 'get', headers: { Authorization: 'Bearer ' + token } },
    'Gmail profile'
  );
  Logger.log('  メールボックス: ' + res.emailAddress + ' / 総メッセージ数: ' + res.messagesTotal);
  assert_(res.emailAddress, 'なりすましでプロフィールを取得できた');
}

/** LINE WORKSの認証が通るか。データ取得はしない */
function testLineWorksAuth() {
  var token = getLineWorksAccessToken_('monitoring.read');
  assert_(token && token.length > 20, 'monitoring.read のトークンを取得できた');
  var botToken = getLineWorksAccessToken_('bot');
  assert_(botToken && botToken.length > 20, 'bot のトークンを取得できた');
}

/** 経営データのスプレッドシートを読めるか */
function testBusinessData() {
  var data = loadBusinessData_();
  if (!data.length) {
    Logger.log('  情報: 経営データは未設定です（BIZ_SPREADSHEET_ID と BIZ_*_RANGE を確認）');
    return;
  }
  data.forEach(function (d) {
    Logger.log('  ' + d.title + ': ' + d.rows.length + '行');
  });
  Logger.log('----- AIへ渡す形 -----\n' + formatBusinessDataForAi_(data).slice(0, 1000));
}

/** Geminiとの疎通確認。短い固定文で1回だけ呼ぶ */
function testGemini() {
  var text = callGemini_('次の一文をそのまま繰り返してください：接続テスト成功');
  Logger.log('  応答: ' + text);
  assert_(text.indexOf('接続テスト成功') >= 0, 'Geminiから期待どおりの応答が返った');
}

/** 報告を作るところまで通す。送信はしない */
function testDailyReportDryRun() {
  var report = generateDailyReportWithoutSending();
  Logger.log('----- 生成された報告 -----\n' + report);
  return report;
}

// ------------------------------------------------------------------
// 送信テスト（社内のみ）
// ------------------------------------------------------------------

/** 管理者へテスト通知を1通送る */
function testNotifyAdmin() {
  var ok = notifyAdmin_('通知テスト', 'これは経営AI管制塔の通知テストです。この文面が届いていれば設定は正しく完了しています。');
  assert_(ok, '管理者への通知が送れた（Botまたはメール）');
}

/** 経営者へテスト通知を1通送る */
function testNotifyPresident() {
  var result = notifyPresident_('【テスト送信】経営AI管制塔の設定確認です。明日の朝から日次報告が届きます。');
  Logger.log('  結果: ' + result);
}

// ------------------------------------------------------------------
// サンプルデータ
// ------------------------------------------------------------------

/**
 * 前日付のサンプルデータを投入する。
 * API未接続の状態でも報告の生成まで一通り試せる。
 */
function testInsertSampleData() {
  var range = targetDateRange_(cfgNum_('REPORT_TARGET_OFFSET_DAYS', 1));
  var d = range.label;
  var now = formatDateTime_(new Date());
  var orgs = getOrganizations_();
  var org = function (i) { return orgs[Math.min(i, orgs.length - 1)] || { orgName: '不明', segment: 'その他' }; };

  var mails = [
    [d + ' 08:12:00', org(0).orgName, org(0).segment, '田中建材', 'tanaka@torihikisaki.example.jp',
      'info@example-kaitai.co.jp', '【至急】現場の資材納入遅延について', 'TRUE',
      '本日予定の鉄骨材が搬入できません。連絡先は 090-1111-2222 です。工程の再調整をお願いします。',
      'info@example-kaitai.co.jp', SAMPLE_PREFIX_ + 'mail1', now],
    [d + ' 10:40:00', org(0).orgName, org(0).segment, '近隣住民', 'resident@example.com',
      'info@example-kaitai.co.jp', '解体工事の騒音について', 'TRUE',
      '朝7時からの作業音が大きく困っています。クレームとして記録をお願いします。',
      'info@example-kaitai.co.jp', SAMPLE_PREFIX_ + 'mail2', now],
    [d + ' 14:05:00', org(2).orgName, org(2).segment, '入居者A', 'nyukyo@example.com',
      'info@example-fudosan.co.jp', '水漏れの件', 'TRUE',
      '洗面台の下から水漏れがあります。至急ご確認ください。',
      'info@example-fudosan.co.jp', SAMPLE_PREFIX_ + 'mail3', now],
    [d + ' 16:20:00', org(1).orgName, org(1).segment, '事務局', 'jimu@example-chiiki.co.jp',
      'info@example-chiiki.co.jp', '定例会の議事録送付', 'FALSE',
      '先日の定例会の議事録をお送りします。ご確認ください。',
      'info@example-chiiki.co.jp', SAMPLE_PREFIX_ + 'mail4', now]
  ];

  var talks = [
    [d + ' 07:55:00', org(0).orgName, '解体現場A', '藤井', 'fujii@example-kaitai.co.jp',
      '本日の重機、朝一で到着しました。予定どおり進めます。', SAMPLE_PREFIX_ + 'talk1', now],
    [d + ' 11:30:00', org(0).orgName, '解体現場A', '成相', 'nariai@example-kaitai.co.jp',
      '職人が1名欠員です。明日以降の配置を相談させてください。', SAMPLE_PREFIX_ + 'talk2', now],
    [d + ' 13:10:00', org(3).orgName, '福祉事業部', '川野', 'kawano@example-fukushi.or.jp',
      '利用者の欠席連絡が3件ありました。ケアプランの更新期限が今月末です。', SAMPLE_PREFIX_ + 'talk3', now],
    [d + ' 17:45:00', org(2).orgName, '不動産管理', '坂本', 'sakamoto@example-fudosan.co.jp',
      '退去立会いの日程、来週水曜で調整中です。', SAMPLE_PREFIX_ + 'talk4', now]
  ];

  var lines = [
    [d + ' 09:20:00', '山本さま', 'Usample0001', '外構工事の見積をお願いしたいのですが、来週伺えますか。', 'text', SAMPLE_PREFIX_ + 'line1', now],
    [d + ' 19:02:00', '', 'Usample0002', '先日はありがとうございました。', 'text', SAMPLE_PREFIX_ + 'line2', now]
  ];

  appendRows_(SHEET.MAIL, mails);
  appendRows_(SHEET.TALK, talks);
  appendRows_(SHEET.LINE, lines);

  var msg = 'サンプルデータを投入しました（対象日 ' + d + '）。\n'
    + 'メール' + mails.length + '件 / トーク' + talks.length + '件 / LINE' + lines.length + '件\n'
    + '確認後は testClearSampleData() で削除してください。';
  Logger.log(msg);
  return msg;
}

/** サンプルデータを削除する */
function testClearSampleData() {
  var total = 0;
  [[SHEET.MAIL, 11], [SHEET.TALK, 7], [SHEET.LINE, 6]].forEach(function (pair) {
    total += deleteRowsByIdPrefix_(pair[0], pair[1], SAMPLE_PREFIX_);
  });
  var msg = 'サンプルデータを ' + total + ' 行削除しました。';
  Logger.log(msg);
  return msg;
}

/** 指定列が prefix で始まる行を削除する（下から消す） */
function deleteRowsByIdPrefix_(sheetName, idColumn, prefix) {
  var sh = sheet_(sheetName);
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var values = sh.getRange(2, idColumn, last - 1, 1).getValues();
  var deleted = 0;
  for (var i = values.length - 1; i >= 0; i--) {
    if (String(values[i][0]).indexOf(prefix) === 0) {
      sh.deleteRow(i + 2);
      deleted++;
    }
  }
  return deleted;
}
