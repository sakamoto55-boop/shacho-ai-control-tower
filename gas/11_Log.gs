/**
 * 11_Log.gs
 * ------------------------------------------------------------------
 * RUN_LOG（実行記録）と REPORT_LOG（生成した報告の保存）、
 * および全シート共通の追記ヘルパ。
 *
 * 追記は必ずロックを取ってから行う（Webhook受信と日次バッチが
 * 同時に同じシートへ書き込むと行が壊れるため）。
 * ------------------------------------------------------------------
 */

/**
 * この実行がすでにスクリプトロックを持っているか。
 * GASのロックは同一実行の中で取り直すと待ちに入ってしまうため、
 * 二重取得を避けるためのフラグ。
 */
var SCRIPT_LOCK_HELD_ = false;

/**
 * スクリプトロックを取って処理を実行する（多重実行防止の共通入口）。
 * すでにこの実行がロックを持っていれば、取り直さずそのまま実行する。
 *
 * @param {number} timeoutMs ロック取得を待つ上限
 * @param {function} fn 実行する処理
 * @return {boolean} ロックが取れて実行できたか
 */
function runWithScriptLock_(timeoutMs, fn) {
  if (SCRIPT_LOCK_HELD_) {
    fn();
    return true;
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(timeoutMs)) return false;
  SCRIPT_LOCK_HELD_ = true;
  try {
    fn();
  } finally {
    SCRIPT_LOCK_HELD_ = false;
    lock.releaseLock();
  }
  return true;
}

/**
 * シートへ複数行を追記する。
 * @param {string} sheetName
 * @param {Array<Array>} rows
 * @return {number} 追記した行数
 */
function appendRows_(sheetName, rows) {
  if (!rows || !rows.length) return 0;
  var written = 0;
  var ok = runWithScriptLock_(20000, function () {
    var sh = sheet_(sheetName);
    var width = SHEET_HEADERS[sheetName].length;
    var normalized = rows.map(function (r) {
      var row = r.slice(0, width);
      while (row.length < width) row.push('');
      return row;
    });
    sh.getRange(sh.getLastRow() + 1, 1, normalized.length, width).setValues(normalized);
    SpreadsheetApp.flush();
    written = normalized.length;
  });
  if (!ok) {
    throw new Error('シート ' + sheetName + ' への追記でロックを取得できませんでした（他の実行が長時間占有しています）。');
  }
  return written;
}

/**
 * 実行記録を残す。
 * @param {string} job ジョブ名
 * @param {string} status OK / SKIP / ERROR
 * @param {number} count 処理件数
 * @param {number} elapsedMs 所要ミリ秒
 * @param {string} message 補足
 */
function logRun_(job, status, count, elapsedMs, message) {
  try {
    appendRows_(SHEET.RUN_LOG, [[
      formatDateTime_(new Date()),
      job,
      status,
      count || 0,
      elapsedMs || 0,
      String(message || '').slice(0, 1000)
    ]]);
  } catch (e) {
    // ログ書き込みの失敗で本処理を止めない
    Logger.log('RUN_LOGへの書き込みに失敗: ' + e);
  }
}

/** RUN_LOGが長くなりすぎたら古い行を削除する */
function rotateRunLog_() {
  var max = cfgNum_('RUN_LOG_MAX_ROWS', 5000);
  var sh = sheet_(SHEET.RUN_LOG);
  var last = sh.getLastRow();
  if (last <= max + 1) return 0;
  var deleteCount = last - 1 - max;
  sh.deleteRows(2, deleteCount);
  return deleteCount;
}

/** 生成した報告を保存する */
function logReport_(targetDate, model, promptChars, text, sendResult) {
  appendRows_(SHEET.REPORT_LOG, [[
    formatDateTime_(new Date()),
    targetDate,
    model,
    promptChars,
    String(text || '').length,
    sendResult,
    text
  ]]);
}

// ------------------------------------------------------------------
// 日時ユーティリティ
// ------------------------------------------------------------------

function formatDateTime_(date) {
  return Utilities.formatDate(date, timezone_(), 'yyyy/MM/dd HH:mm:ss');
}

/**
 * シートのセル値を 'yyyy/MM/dd HH:mm:ss' の文字列に揃える。
 * 日時列は書式を文字列にしてあるが、手作業で貼り付けた行などが
 * 日付型になっていることがあるため、どちらでも扱えるようにしている。
 */
function cellToDateTimeString_(value) {
  if (value instanceof Date) return formatDateTime_(value);
  return String(value == null ? '' : value);
}

function formatDate_(date) {
  return Utilities.formatDate(date, timezone_(), 'yyyy/MM/dd');
}

function formatDateKey_(date) {
  return Utilities.formatDate(date, timezone_(), 'yyyy-MM-dd');
}

/**
 * 今日から offsetDays 日前の「その日の0時00分」を返す。
 * 文字列にタイムゾーン（例 GMT+09:00）を含めてから Date に戻すことで、
 * サーバー側のロケールに左右されずに日本時間の0時を得る。
 */
function dayStart_(offsetDays) {
  var base = new Date(Date.now() - (offsetDays || 0) * 86400000);
  return new Date(Utilities.formatDate(base, timezone_(), 'yyyy/MM/dd 00:00:00 ZZZZ'));
}

/**
 * 報告・収集の対象日レンジを返す。
 * @param {number} offsetDays 何日前を対象にするか（1なら前日）
 * @return {{start: Date, end: Date, label: string}}
 */
function targetDateRange_(offsetDays) {
  var start = dayStart_(offsetDays);
  var end = new Date(start.getTime() + 86400000);
  return { start: start, end: end, label: formatDate_(start) };
}
