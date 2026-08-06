/**
 * 01_Setup.gs
 * ------------------------------------------------------------------
 * 初回セットアップ用。DX担当者はまず setupAll() を1回実行するだけでよい。
 *
 *  setupAll()
 *    ├ setupSheets()   … 必要なシートを作り、見出しと初期値を入れる
 *    ├ setupTriggers() … 毎日の実行トリガーを登録する
 *    └ checkProperties() … スクリプトプロパティの過不足を点検して表示する
 * ------------------------------------------------------------------
 */

/** 初回セットアップ。何度実行しても壊れない（既存データは消さない）。 */
function setupAll() {
  var messages = [];
  messages.push(setupSheets());
  messages.push(setupTriggers());
  messages.push(checkProperties());
  var text = messages.join('\n\n');
  Logger.log(text);
  try {
    SpreadsheetApp.getUi().alert('セットアップ結果', text, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    // スクリプトエディタから直接実行した場合はUIが使えないのでログのみ
  }
  return text;
}

/** 必要なシートを作成し、見出しと初期値を投入する */
function setupSheets() {
  var ss = baseSpreadsheet_();
  var created = [];
  var kept = [];

  Object.keys(SHEET_HEADERS).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      created.push(name);
    } else {
      kept.push(name);
    }
    writeHeaderIfEmpty_(sh, SHEET_HEADERS[name]);
  });

  // 初期値の投入（既に1行でもデータがあれば触らない）
  seedIfEmpty_(ss.getSheetByName(SHEET.CONFIG), CONFIG_DEFAULTS);
  seedIfEmpty_(ss.getSheetByName(SHEET.CONFIG_ORG), CONFIG_ORG_DEFAULTS);
  seedIfEmpty_(ss.getSheetByName(SHEET.CONFIG_MAIL_TARGET), CONFIG_MAIL_TARGET_DEFAULTS);
  seedIfEmpty_(ss.getSheetByName(SHEET.CONFIG_MASK), CONFIG_MASK_DEFAULTS);

  // 日時列とID列を「書式なしテキスト」にする。
  // Googleスプレッドシートが自動で日付型や数値型へ変換してしまうと、
  // 重複排除や日付での絞り込みが狂うため。
  applyTextFormats_();

  // CONFIGに後から追加されたキーを補う（バージョンアップ時の取りこぼし防止）
  var added = mergeConfigDefaults_();

  clearConfigCache_();

  return [
    '■ シート',
    '  新規作成: ' + (created.length ? created.join(', ') : 'なし'),
    '  既存のまま: ' + (kept.length ? kept.join(', ') : 'なし'),
    '  CONFIGに追加したキー: ' + (added.length ? added.join(', ') : 'なし')
  ].join('\n');
}

/**
 * 日時列・ID列を書式なしテキストにする。
 * 例：メッセージIDが数字だけだったときに数値へ変換され、
 *     先頭の0が消えて重複排除が効かなくなるのを防ぐ。
 */
function applyTextFormats_() {
  var plan = {};
  plan[SHEET.MAIL] = [1, 11, 12];
  plan[SHEET.TALK] = [1, 7, 8];
  plan[SHEET.LINE] = [1, 3, 6, 7];
  plan[SHEET.REPORT_LOG] = [1, 2];
  plan[SHEET.RUN_LOG] = [1];

  var ss = baseSpreadsheet_();
  Object.keys(plan).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    plan[name].forEach(function (col) {
      sh.getRange(2, col, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat('@');
    });
  });
}

function writeHeaderIfEmpty_(sheet, headers) {
  var firstRow = sheet.getRange(1, 1, 1, Math.max(headers.length, 1)).getValues()[0];
  var hasHeader = firstRow.some(function (v) { return String(v).trim() !== ''; });
  if (hasHeader) return;
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#f0f0f0');
  sheet.setFrozenRows(1);
}

function seedIfEmpty_(sheet, rows) {
  if (!sheet || !rows || !rows.length) return;
  if (sheet.getLastRow() > 1) return; // 既にデータあり
  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

/** CONFIGシートに未登録のデフォルトキーを追記する */
function mergeConfigDefaults_() {
  var sh = baseSpreadsheet_().getSheetByName(SHEET.CONFIG);
  if (!sh) return [];
  var values = sh.getDataRange().getValues();
  var existing = {};
  for (var i = 1; i < values.length; i++) {
    var k = String(values[i][0]).trim();
    if (k) existing[k] = true;
  }
  var toAdd = CONFIG_DEFAULTS.filter(function (row) { return !existing[row[0]]; });
  if (toAdd.length) {
    sh.getRange(sh.getLastRow() + 1, 1, toAdd.length, 3).setValues(toAdd);
  }
  return toAdd.map(function (row) { return row[0]; });
}

/**
 * トリガーを登録する。既存の同名トリガーは一度削除してから作り直す。
 *
 *  03:00 startDailyCollection … 収集開始（続きは自動で再スケジュールされる）
 *  06:00 runDailyReport       … AI報告の生成と送信
 *  03:30 flushLineQueue       … LINE公式アカウントの取りこぼし退避分を書き出す
 */
function setupTriggers() {
  var managed = ['startDailyCollection', 'runDailyReport', 'flushLineQueue', 'runCollectStep'];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (managed.indexOf(t.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('startDailyCollection').timeBased().atHour(3).nearMinute(0).everyDays(1).create();
  ScriptApp.newTrigger('flushLineQueue').timeBased().atHour(3).nearMinute(30).everyDays(1).create();
  ScriptApp.newTrigger('runDailyReport').timeBased().atHour(6).nearMinute(0).everyDays(1).create();

  return [
    '■ トリガー',
    '  03:00 startDailyCollection（収集）',
    '  03:30 flushLineQueue（LINE退避分の書き出し）',
    '  06:00 runDailyReport（AI報告の生成・送信）',
    '  ※GASの時間指定は前後15分程度ずれることがあります'
  ].join('\n');
}

/** すべてのトリガーを削除する（運用停止時に使う） */
function deleteAllTriggers() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    ScriptApp.deleteTrigger(t);
    n++;
  });
  Logger.log(n + '件のトリガーを削除しました。');
  return n;
}

/** スクリプトプロパティの過不足を点検する（値そのものは絶対に表示しない） */
function checkProperties() {
  var lines = ['■ スクリプトプロパティ'];
  var missingRequired = [];
  PROP_SPEC.forEach(function (spec) {
    var v = scriptProps_().getProperty(spec.key);
    var set = v !== null && v !== '';
    if (!set && spec.required) missingRequired.push(spec.key);
    lines.push('  ' + (set ? '[設定済]' : (spec.required ? '[未設定★]' : '[未設定 ]')) + ' ' + spec.key + ' … ' + spec.desc);
  });
  if (missingRequired.length) {
    lines.push('');
    lines.push('  ★必須が未設定です: ' + missingRequired.join(', '));
  }
  return lines.join('\n');
}

/** スプレッドシートを開いたときにメニューを出す（DX担当者の操作用） */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('経営AI管制塔')
      .addItem('初回セットアップ', 'setupAll')
      .addItem('スクリプトプロパティ点検', 'showPropertyCheck')
      .addSeparator()
      .addItem('今すぐ収集する', 'startDailyCollection')
      .addItem('今すぐ報告を作る（送信あり）', 'runDailyReport')
      .addItem('報告を試作する（送信なし）', 'testDailyReportDryRun')
      .addSeparator()
      .addItem('動作テスト（送信なし・一括）', 'testAll')
      .addToUi();
  } catch (e) {
    // 権限未承認時などは無視
  }
}

function showPropertyCheck() {
  var text = checkProperties();
  SpreadsheetApp.getUi().alert('スクリプトプロパティ点検', text, SpreadsheetApp.getUi().ButtonSet.OK);
}
