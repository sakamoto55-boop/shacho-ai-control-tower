/**
 * SheetTaskRepository.gs
 * Google スプレッドシートへのタスク登録・ログ記録・重複チェック
 */

/**
 * スプレッドシートオブジェクトを取得する
 * @param {string} spreadsheetId
 * @returns {Spreadsheet}
 */
function getSpreadsheet(spreadsheetId) {
  return SpreadsheetApp.openById(spreadsheetId);
}

/**
 * タスクシートを初期化する（ヘッダー・データ検証・列幅を設定）
 * @param {Spreadsheet} ss
 * @returns {Sheet}
 */
function initializeTaskSheet(ss) {
  let sheet = ss.getSheetByName(SHEET_NAMES.TASKS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.TASKS);
  }

  const headers = [
    '登録日時', '受信日時', '優先度', 'ステータス', 'カテゴリ',
    '担当候補', '送信者', '件名', '要約', '対応タスク',
    '返信案', '期限目安', 'リスクメモ', 'Gmailリンク', '下書きID',
    'メッセージID', 'スレッドID', 'AI判定理由', '対応者', '完了日時',
    '対応メモ'
  ];

  // ヘッダー行のスタイル設定
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setBackground('#1a73e8');
  headerRange.setFontColor('#ffffff');
  headerRange.setFontWeight('bold');
  headerRange.setFontSize(10);
  sheet.setFrozenRows(1);

  // 列幅設定
  const colWidths = {
    [TASK_COLUMNS.REGISTERED_AT]: 145,
    [TASK_COLUMNS.RECEIVED_AT]: 145,
    [TASK_COLUMNS.PRIORITY]: 60,
    [TASK_COLUMNS.STATUS]: 80,
    [TASK_COLUMNS.CATEGORY]: 100,
    [TASK_COLUMNS.ASSIGNEE_HINT]: 100,
    [TASK_COLUMNS.SENDER]: 200,
    [TASK_COLUMNS.SUBJECT]: 250,
    [TASK_COLUMNS.SUMMARY]: 300,
    [TASK_COLUMNS.TASK]: 250,
    [TASK_COLUMNS.REPLY_DRAFT]: 350,
    [TASK_COLUMNS.DUE_HINT]: 100,
    [TASK_COLUMNS.RISK_NOTE]: 200,
    [TASK_COLUMNS.GMAIL_LINK]: 80,
    [TASK_COLUMNS.DRAFT_ID]: 120,
    [TASK_COLUMNS.MESSAGE_ID]: 160,
    [TASK_COLUMNS.THREAD_ID]: 160,
    [TASK_COLUMNS.AI_REASON]: 250,
    [TASK_COLUMNS.OPERATOR]: 100,
    [TASK_COLUMNS.COMPLETED_AT]: 120,
    [TASK_COLUMNS.OPERATION_NOTE]: 200
  };
  for (const [col, width] of Object.entries(colWidths)) {
    sheet.setColumnWidth(Number(col), width);
  }

  // データ検証：ステータス・優先度・カテゴリ
  setDropdownValidation(sheet, TASK_COLUMNS.STATUS, STATUS_OPTIONS);
  setDropdownValidation(sheet, TASK_COLUMNS.PRIORITY, PRIORITY_OPTIONS);
  setDropdownValidation(sheet, TASK_COLUMNS.CATEGORY, CATEGORY_OPTIONS);

  Logger.log(`シート「${SHEET_NAMES.TASKS}」初期化完了`);
  return sheet;
}

/**
 * ログシートを初期化する
 * @param {Spreadsheet} ss
 * @returns {Sheet}
 */
function initializeLogSheet(ss) {
  let sheet = ss.getSheetByName(SHEET_NAMES.LOGS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.LOGS);
  }

  const headers = [
    '処理日時', '処理結果', 'メッセージID', 'スレッドID', '受信日時',
    '送信者', '件名', 'AI対応要否', '優先度', 'カテゴリ',
    'メモ', 'エラー詳細'
  ];

  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setBackground('#34a853');
  headerRange.setFontColor('#ffffff');
  headerRange.setFontWeight('bold');
  headerRange.setFontSize(10);
  sheet.setFrozenRows(1);

  sheet.setColumnWidth(LOG_COLUMNS.PROCESSED_AT, 145);
  sheet.setColumnWidth(LOG_COLUMNS.MESSAGE_ID, 160);
  sheet.setColumnWidth(LOG_COLUMNS.NOTE, 300);
  sheet.setColumnWidth(LOG_COLUMNS.ERROR_DETAIL, 300);

  Logger.log(`シート「${SHEET_NAMES.LOGS}」初期化完了`);
  return sheet;
}

/**
 * 指定列にプルダウン検証を設定する（2行目〜1000行目）
 * @param {Sheet} sheet
 * @param {number} colIndex 列インデックス（1始まり）
 * @param {string[]} options 選択肢一覧
 */
function setDropdownValidation(sheet, colIndex, options) {
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(options, true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, colIndex, 999, 1).setDataValidation(rule);
}

/**
 * タスクをスプレッドシートに1行追加する
 * @param {Spreadsheet} ss
 * @param {Object} emailInfo extractEmailInfo() の戻り値
 * @param {Object} aiResult normalizeAiResult() の戻り値
 * @param {string} draftId 下書きID または 'DRY_RUN_DRAFT'
 * @returns {string} 追加行へのスプレッドシート URL
 */
function registerTask(ss, emailInfo, aiResult, draftId) {
  const sheet = ss.getSheetByName(SHEET_NAMES.TASKS);
  if (!sheet) throw new Error(`シート「${SHEET_NAMES.TASKS}」が見つかりません`);

  const now = new Date();
  const row = [
    now,                        // 登録日時
    emailInfo.date,             // 受信日時
    aiResult.priority,          // 優先度
    '未対応',                   // ステータス
    aiResult.category,          // カテゴリ
    aiResult.assignee_hint,     // 担当候補
    emailInfo.from,             // 送信者
    emailInfo.subject,          // 件名
    aiResult.summary,           // 要約
    aiResult.task,              // 対応タスク
    aiResult.reply_draft,       // 返信案
    aiResult.due_hint,          // 期限目安
    aiResult.risk_note,         // リスクメモ
    emailInfo.gmailLink,        // Gmail リンク
    draftId,                    // 下書き ID
    emailInfo.messageId,        // メッセージ ID
    emailInfo.threadId,         // スレッド ID
    aiResult.reason,            // AI 判定理由
    '',                         // 対応者
    '',                         // 完了日時
    ''                          // 対応メモ
  ];

  sheet.appendRow(row);
  const lastRow = sheet.getLastRow();

  // 日時列のフォーマット
  sheet.getRange(lastRow, TASK_COLUMNS.REGISTERED_AT)
    .setNumberFormat('yyyy/MM/dd HH:mm');
  sheet.getRange(lastRow, TASK_COLUMNS.RECEIVED_AT)
    .setNumberFormat('yyyy/MM/dd HH:mm');

  // 折り返し表示（長文列）
  [TASK_COLUMNS.SUMMARY, TASK_COLUMNS.TASK, TASK_COLUMNS.REPLY_DRAFT,
   TASK_COLUMNS.RISK_NOTE, TASK_COLUMNS.AI_REASON].forEach(col => {
    sheet.getRange(lastRow, col).setWrap(true);
  });

  // Gmailリンクをハイパーリンクで表示
  if (emailInfo.gmailLink) {
    sheet.getRange(lastRow, TASK_COLUMNS.GMAIL_LINK)
      .setFormula(`=HYPERLINK("${emailInfo.gmailLink}","開く")`);
  }

  // 優先度に応じて行の背景色を設定
  const rowRange = sheet.getRange(lastRow, 1, 1, headers_count_());
  if (aiResult.priority === '高') {
    rowRange.setBackground('#fce8e6');
  } else if (aiResult.priority === '中') {
    rowRange.setBackground('#fef7e0');
  }

  return generateRowUrl(ss, sheet, lastRow);
}

/**
 * タスクシートのヘッダー列数を返すヘルパー
 */
function headers_count_() {
  return 21; // TASK_COLUMNSの列数
}

/**
 * 処理ログをスプレッドシートに記録する
 * @param {Spreadsheet} ss
 * @param {Object} logEntry ログエントリ
 */
function recordLog(ss, logEntry) {
  const sheet = ss.getSheetByName(SHEET_NAMES.LOGS);
  if (!sheet) return; // ログシートがなくても処理は継続する

  const row = [
    new Date(),
    logEntry.result || '',
    logEntry.messageId || '',
    logEntry.threadId || '',
    logEntry.receivedAt || '',
    logEntry.sender || '',
    logEntry.subject || '',
    logEntry.aiRequiresResponse !== undefined ? (logEntry.aiRequiresResponse ? '要対応' : '不要') : '',
    logEntry.priority || '',
    logEntry.category || '',
    logEntry.note || '',
    logEntry.errorDetail || ''
  ];

  sheet.appendRow(row);
  const lastRow = sheet.getLastRow();
  sheet.getRange(lastRow, LOG_COLUMNS.PROCESSED_AT).setNumberFormat('yyyy/MM/dd HH:mm:ss');
  if (logEntry.receivedAt instanceof Date) {
    sheet.getRange(lastRow, LOG_COLUMNS.RECEIVED_AT).setNumberFormat('yyyy/MM/dd HH:mm');
  }

  // エラー行を赤背景にする
  if (logEntry.result && logEntry.result.includes('ERROR')) {
    sheet.getRange(lastRow, 1, 1, 12).setBackground('#fce8e6');
  }
}

/**
 * ログシートから処理済みメッセージIDのセットを取得する（二重処理防止）
 * @param {Spreadsheet} ss
 * @returns {Set<string>}
 */
function getProcessedMessageIds(ss) {
  const ids = new Set();
  const sheet = ss.getSheetByName(SHEET_NAMES.LOGS);
  if (!sheet || sheet.getLastRow() < 2) return ids;

  const data = sheet.getRange(
    2, LOG_COLUMNS.MESSAGE_ID, sheet.getLastRow() - 1, 1
  ).getValues();

  for (const [id] of data) {
    if (id) ids.add(String(id));
  }
  return ids;
}

/**
 * 特定行へのスプレッドシート URL を生成する
 * @param {Spreadsheet} ss
 * @param {Sheet} sheet
 * @param {number} rowNumber 行番号（1始まり）
 * @returns {string}
 */
function generateRowUrl(ss, sheet, rowNumber) {
  return `https://docs.google.com/spreadsheets/d/${ss.getId()}/edit#gid=${sheet.getSheetId()}&range=A${rowNumber}`;
}
