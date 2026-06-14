/**
 * Setup.gs
 * 初期設定・トリガー作成・各種テスト関数
 *
 * 【使い方】
 * 1. setup()            - 初回セットアップ（シート初期化＋トリガー作成）
 * 2. showConfigStatus() - Script Properties の設定状況確認
 * 3. sendTestLineWorks() - LINE WORKS 通知テスト
 * 4. testGemini()        - Gemini API 疎通テスト
 * 5. manualRun()         - 手動テスト実行（Code.gs に定義）
 * 6. resetRunSlotForTest() - テスト用スロットフラグリセット
 */

/**
 * 初回セットアップ
 * Apps Script エディタから手動実行する
 */
function setup() {
  Logger.log('========== セットアップ開始 ==========');

  // 設定チェック
  const config = getConfig();
  const errors = validateConfig(config);

  if (errors.length > 0) {
    Logger.log('⚠️  以下の Script Properties が未設定です：');
    errors.forEach(e => Logger.log(`   - ${e}`));
    Logger.log('');
    Logger.log('Script Properties を設定してから再度 setup() を実行してください。');
    Logger.log('設定方法: エディタ左メニュー「プロジェクトの設定」→「スクリプトプロパティ」');
    return;
  }

  Logger.log(`対象メール: ${config.targetEmail}`);
  Logger.log(`DRY_RUN: ${config.isDryRun}`);

  // スプレッドシート初期化
  try {
    const ss = getSpreadsheet(config.spreadsheetId);
    initializeTaskSheet(ss);
    initializeLogSheet(ss);
    Logger.log('✅ スプレッドシート初期化完了');
  } catch (e) {
    Logger.log(`❌ スプレッドシート初期化失敗: ${e.message}`);
    Logger.log('SPREADSHEET_ID が正しいか確認してください。');
    return;
  }

  // トリガー作成
  try {
    setupTriggers_();
    Logger.log('✅ トリガー作成完了（10分ごとに scheduledMain を実行）');
  } catch (e) {
    Logger.log(`❌ トリガー作成失敗: ${e.message}`);
  }

  Logger.log('');
  Logger.log('========== セットアップ完了 ==========');
  Logger.log('次のステップ:');
  Logger.log('  1. showConfigStatus()  - 設定状況を確認');
  Logger.log('  2. sendTestLineWorks() - LINE WORKS 疎通確認');
  Logger.log('  3. testGemini()        - Gemini API 疎通確認');
  Logger.log('  4. manualRun()         - DRY_RUN で実際のメールを処理');
}

/**
 * 10分ごとのトリガーをセットアップする（内部用）
 */
function setupTriggers_() {
  // 既存の scheduledMain トリガーを全削除
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'scheduledMain')
    .forEach(t => ScriptApp.deleteTrigger(t));

  // 10分ごとのトリガーを新規作成
  ScriptApp.newTrigger('scheduledMain')
    .timeBased()
    .everyMinutes(10)
    .create();
}

/**
 * Script Properties の設定状況を確認する（値は表示しない）
 */
function showConfigStatus() {
  const props = PropertiesService.getScriptProperties().getProperties();
  Logger.log('========== Script Properties 設定状況 ==========');

  const secretKeys = ['GEMINI_API_KEY', 'LINEWORKS_WEBHOOK_URL'];
  const publicKeys = ['TARGET_EMAIL', 'INTERNAL_DOMAIN', 'DRY_RUN', 'SPREADSHEET_ID',
                      'LAST_SUCCESS_MS', 'LAST_RUN_SLOT'];

  for (const key of secretKeys) {
    Logger.log(props[key] ? `✅ ${key}: 設定済み（値は非表示）` : `❌ ${key}: 未設定`);
  }
  for (const key of publicKeys) {
    const v = props[key];
    if (!v) {
      Logger.log(`⚠️  ${key}: 未設定`);
    } else if (key === 'LAST_SUCCESS_MS' && v !== '0') {
      const d = new Date(parseInt(v, 10));
      Logger.log(`✅ ${key}: ${Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss')} (JST)`);
    } else {
      Logger.log(`✅ ${key}: ${v}`);
    }
  }
  Logger.log('=================================================');
}

/**
 * LINE WORKS 通知テスト
 */
function sendTestLineWorks() {
  const config = getConfig();
  if (!config.lineWorksWebhookUrl) {
    Logger.log('❌ LINEWORKS_WEBHOOK_URL が未設定です');
    return;
  }

  const testTasks = [{
    priority: '高',
    subject: '【テスト】LINE WORKS 通知確認',
    sender: 'テスト送信者 <test@example.com>',
    summary: 'これは LINE WORKS 通知のテストです。このメッセージが届けば正常です。',
    task: 'テストのため対応不要です',
    assigneeHint: 'テスト担当',
    dueHint: '対応不要',
    draftId: 'TEST_DRAFT',
    rowUrl: 'https://example.com'
  }];

  try {
    // テスト通知は常に実際に送信する
    postToLineWorksWebhook(config.lineWorksWebhookUrl, buildNotificationMessage(testTasks, 1));
    Logger.log('✅ LINE WORKS 通知テスト送信完了');
  } catch (e) {
    Logger.log(`❌ LINE WORKS 通知テスト失敗: ${e.message}`);
  }
}

/**
 * Gemini API 疎通テスト（ダミーメールを使用）
 */
function testGemini() {
  const config = getConfig();
  if (!config.geminiApiKey) {
    Logger.log('❌ GEMINI_API_KEY が未設定です');
    return;
  }

  Logger.log('Gemini API テスト中...');
  try {
    const result = testGeminiWithDummyEmail(config.geminiApiKey);
    Logger.log('✅ Gemini API テスト成功');
    Logger.log(`  対応要否  : ${result.requires_response}`);
    Logger.log(`  優先度    : ${result.priority}`);
    Logger.log(`  カテゴリ  : ${result.category}`);
    Logger.log(`  要約      : ${result.summary}`);
    Logger.log(`  対応タスク: ${result.task}`);
    Logger.log(`  担当候補  : ${result.assignee_hint}`);
    Logger.log(`  期限目安  : ${result.due_hint}`);
    Logger.log(`  判断理由  : ${result.reason}`);
  } catch (e) {
    Logger.log(`❌ Gemini API テスト失敗: ${e.message}`);
  }
}

/**
 * スプレッドシート初期化テスト（シートの存在と構造を確認する）
 */
function testSheetInitialization() {
  const config = getConfig();
  if (!config.spreadsheetId) {
    Logger.log('❌ SPREADSHEET_ID が未設定です');
    return;
  }

  try {
    const ss = getSpreadsheet(config.spreadsheetId);
    const taskSheet = ss.getSheetByName(SHEET_NAMES.TASKS);
    const logSheet = ss.getSheetByName(SHEET_NAMES.LOGS);

    Logger.log(`タスクシート「${SHEET_NAMES.TASKS}」: ${taskSheet ? '✅ 存在' : '❌ なし'}`);
    Logger.log(`ログシート「${SHEET_NAMES.LOGS}」: ${logSheet ? '✅ 存在' : '❌ なし'}`);

    if (taskSheet) {
      const hRow = taskSheet.getRange(1, 1, 1, 21).getValues()[0];
      Logger.log(`タスクシート列数: ${hRow.filter(h => h !== '').length}`);
      Logger.log(`先頭5列: ${hRow.slice(0, 5).join(' | ')}`);
    }
    if (logSheet) {
      const hRow = logSheet.getRange(1, 1, 1, 12).getValues()[0];
      Logger.log(`ログシート列数: ${hRow.filter(h => h !== '').length}`);
    }
  } catch (e) {
    Logger.log(`❌ シート確認エラー: ${e.message}`);
  }
}

/**
 * テスト用：当日の実行済みスロットフラグをリセットする
 * 同じ時間帯に再実行したい場合に使う
 */
function resetRunSlotForTest() {
  PropertiesService.getScriptProperties().deleteProperty(CONFIG_KEYS.LAST_RUN_SLOT);
  Logger.log('✅ 実行済みスロットフラグをリセットしました');
  Logger.log('   次回 scheduledMain が呼ばれたときに再処理されます');
}

/**
 * テスト用：LAST_SUCCESS_MS をリセットする（初回実行状態に戻す）
 */
function resetLastSuccessMsForTest() {
  PropertiesService.getScriptProperties().deleteProperty(CONFIG_KEYS.LAST_SUCCESS_MS);
  Logger.log('✅ LAST_SUCCESS_MS をリセットしました（直近3日分が対象になります）');
}

/**
 * 現在の設定と状態をまとめて表示するデバッグ関数
 */
function debugStatus() {
  showConfigStatus();

  const now = new Date();
  Logger.log(`現在時刻 (JST): ${Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss')}`);
  Logger.log(`曜日: ${['日','月','火','水','木','金','土'][now.getDay()]}`);
  Logger.log(`現在の時間帯は処理対象か: ${RUN_HOURS.includes(parseInt(Utilities.formatDate(now, 'Asia/Tokyo', 'HH'), 10))}`);

  const triggers = ScriptApp.getProjectTriggers();
  Logger.log(`登録済みトリガー: ${triggers.length}件`);
  triggers.forEach(t => {
    Logger.log(`  - ${t.getHandlerFunction()} (${t.getTriggerSource()})`);
  });
}
