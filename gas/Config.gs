/**
 * Config.gs
 * Script Properties からの設定取得・検証・定数定義
 */

// Script Properties のキー名
const CONFIG_KEYS = {
  GEMINI_API_KEY: 'GEMINI_API_KEY',
  LINEWORKS_WEBHOOK_URL: 'LINEWORKS_WEBHOOK_URL',
  SPREADSHEET_ID: 'SPREADSHEET_ID',
  TARGET_EMAIL: 'TARGET_EMAIL',
  INTERNAL_DOMAIN: 'INTERNAL_DOMAIN',
  DRY_RUN: 'DRY_RUN',
  LAST_SUCCESS_MS: 'LAST_SUCCESS_MS',
  LAST_RUN_SLOT: 'LAST_RUN_SLOT'
};

// デフォルト値
const DEFAULT_CONFIG = {
  TARGET_EMAIL: 'info@lcc55.com',
  INTERNAL_DOMAIN: 'lcc55.com',
  DRY_RUN: 'true'
};

// シート名
const SHEET_NAMES = {
  TASKS: 'メール対応タスク',
  LOGS: '処理ログ'
};

// タスクシートの列インデックス（1始まり）
const TASK_COLUMNS = {
  REGISTERED_AT: 1,
  RECEIVED_AT: 2,
  PRIORITY: 3,
  STATUS: 4,
  CATEGORY: 5,
  ASSIGNEE_HINT: 6,
  SENDER: 7,
  SUBJECT: 8,
  SUMMARY: 9,
  TASK: 10,
  REPLY_DRAFT: 11,
  DUE_HINT: 12,
  RISK_NOTE: 13,
  GMAIL_LINK: 14,
  DRAFT_ID: 15,
  MESSAGE_ID: 16,
  THREAD_ID: 17,
  AI_REASON: 18,
  OPERATOR: 19,
  COMPLETED_AT: 20,
  OPERATION_NOTE: 21
};

// ログシートの列インデックス（1始まり）
const LOG_COLUMNS = {
  PROCESSED_AT: 1,
  RESULT: 2,
  MESSAGE_ID: 3,
  THREAD_ID: 4,
  RECEIVED_AT: 5,
  SENDER: 6,
  SUBJECT: 7,
  AI_REQUIRES_RESPONSE: 8,
  PRIORITY: 9,
  CATEGORY: 10,
  NOTE: 11,
  ERROR_DETAIL: 12
};

// プルダウン選択肢
const STATUS_OPTIONS = ['未対応', '対応中', '完了', '保留', '対応不要'];
const PRIORITY_OPTIONS = ['高', '中', '低'];
const CATEGORY_OPTIONS = [
  '見積依頼', '顧客問い合わせ', 'クレーム', '日程調整', '請求経理',
  '協力会社', '採用', '行政金融', '営業広告', '通知', 'その他'
];

// 実行設定
const RUN_HOURS = [8, 13, 16];          // 処理を行うJST時間帯
const GMAIL_SEARCH_DAYS = 7;            // Gmail検索範囲（日）
const INITIAL_RUN_DAYS = 3;             // 初回実行時の対象日数
const MAX_EMAILS_PER_RUN = 50;          // 1回の実行で処理する最大メール数
const MAX_BODY_LENGTH = 3000;           // AI に渡すメール本文の最大文字数
const MAX_LINEWORKS_TASKS = 5;          // LINE WORKS通知の最大タスク表示件数
const MAX_NOTIFICATION_LENGTH = 3500;   // LINE WORKS通知の最大文字数

// Gemini API 設定
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_TIMEOUT_MS = 30000;

/**
 * Script Properties から設定を取得する
 * @returns {Object} 設定オブジェクト
 */
function getConfig() {
  const props = PropertiesService.getScriptProperties().getProperties();
  return {
    geminiApiKey: props[CONFIG_KEYS.GEMINI_API_KEY] || '',
    lineWorksWebhookUrl: props[CONFIG_KEYS.LINEWORKS_WEBHOOK_URL] || '',
    spreadsheetId: props[CONFIG_KEYS.SPREADSHEET_ID] || '',
    targetEmail: props[CONFIG_KEYS.TARGET_EMAIL] || DEFAULT_CONFIG.TARGET_EMAIL,
    internalDomain: props[CONFIG_KEYS.INTERNAL_DOMAIN] || DEFAULT_CONFIG.INTERNAL_DOMAIN,
    isDryRun: (props[CONFIG_KEYS.DRY_RUN] || DEFAULT_CONFIG.DRY_RUN).toLowerCase() === 'true',
    lastSuccessMs: parseInt(props[CONFIG_KEYS.LAST_SUCCESS_MS] || '0', 10),
    lastRunSlot: props[CONFIG_KEYS.LAST_RUN_SLOT] || ''
  };
}

/**
 * 必須設定の存在チェック
 * @param {Object} config getConfig() の戻り値
 * @returns {string[]} エラーメッセージの配列（空なら正常）
 */
function validateConfig(config) {
  const errors = [];
  if (!config.geminiApiKey) errors.push('GEMINI_API_KEY が未設定です');
  if (!config.lineWorksWebhookUrl) errors.push('LINEWORKS_WEBHOOK_URL が未設定です');
  if (!config.spreadsheetId) errors.push('SPREADSHEET_ID が未設定です');
  return errors;
}

/**
 * LAST_SUCCESS_MS を更新する（処理成功時に呼ぶ）
 * @param {number} timestampMs Unix時間（ミリ秒）
 */
function updateLastSuccessMs(timestampMs) {
  PropertiesService.getScriptProperties()
    .setProperty(CONFIG_KEYS.LAST_SUCCESS_MS, String(timestampMs));
}

/**
 * LAST_RUN_SLOT を更新する（二重実行防止）
 * @param {string} slot yyyyMMdd_HH 形式のスロットキー
 */
function updateLastRunSlot(slot) {
  PropertiesService.getScriptProperties()
    .setProperty(CONFIG_KEYS.LAST_RUN_SLOT, slot);
}
