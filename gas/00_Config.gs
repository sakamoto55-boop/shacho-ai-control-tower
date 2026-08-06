/**
 * 00_Config.gs
 * ------------------------------------------------------------------
 * 設定値の読み出しを一手に引き受けるモジュール。
 *
 * 【重要な方針】
 * - 認証情報（APIキー・秘密鍵・ID類）は必ずスクリプトプロパティから読む。
 *   コードへの直書きは禁止。
 * - 動作パラメータ（上限件数・対象日数など）はCONFIGシートから読む。
 *   → DX担当者がコードを触らずに調整できるようにするため。
 * - 法人/事業部の一覧、収集対象メールアドレス、マスキングルールは
 *   それぞれ CONFIG_ORG / CONFIG_MAIL_TARGET / CONFIG_MASK シートで管理する。
 *   （仕様上は「CONFIGシート」1枚だが、行の意味が違うものを混ぜると
 *     非エンジニアが編集しづらいため、用途別に分割している）
 * ------------------------------------------------------------------
 */

/** シート名の定義 */
var SHEET = {
  MAIL: 'DATA_MAIL',
  TALK: 'DATA_TALK',
  LINE: 'DATA_LINE',
  CONFIG: 'CONFIG',
  CONFIG_ORG: 'CONFIG_ORG',
  CONFIG_MAIL_TARGET: 'CONFIG_MAIL_TARGET',
  CONFIG_MASK: 'CONFIG_MASK',
  REPORT_LOG: 'REPORT_LOG',
  RUN_LOG: 'RUN_LOG'
};

/** 各シートの見出し行 */
var SHEET_HEADERS = {};
SHEET_HEADERS[SHEET.MAIL] = [
  '日時', '法人', '事業区分', '差出人', '差出人アドレス', '宛先', '件名',
  '要約対象', '抜粋', '受信箱', 'メッセージID', '取得日時'
];
SHEET_HEADERS[SHEET.TALK] = [
  '日時', '法人', 'トークルーム', '発言者', '発言者アドレス', '本文',
  'メッセージID', '取得日時'
];
SHEET_HEADERS[SHEET.LINE] = [
  '日時', '顧客', '顧客ID', '本文', '種別', 'イベントID', '取得日時'
];
SHEET_HEADERS[SHEET.CONFIG] = ['キー', '値', '説明'];
SHEET_HEADERS[SHEET.CONFIG_ORG] = [
  '法人ID', '法人名', '事業区分', 'メールドメイン', 'LINE WORKS組織名', '有効'
];
SHEET_HEADERS[SHEET.CONFIG_MAIL_TARGET] = [
  'メールアドレス', '氏名/用途', '法人ID', '事業区分', '有効'
];
SHEET_HEADERS[SHEET.CONFIG_MASK] = ['種別', 'パターン', '置換後', '説明', '有効'];
SHEET_HEADERS[SHEET.REPORT_LOG] = [
  '生成日時', '対象日', 'モデル', '入力文字数', '出力文字数', '送信結果', '本文'
];
SHEET_HEADERS[SHEET.RUN_LOG] = [
  '実行日時', 'ジョブ', 'ステータス', '件数', '所要ms', 'メッセージ'
];

/**
 * スクリプトプロパティのキー一覧（導入手順書と1対1で対応）。
 * required=true のものは未設定だと該当機能が動かない。
 */
var PROP_SPEC = [
  { key: 'GCP_SA_CLIENT_EMAIL', required: true, desc: 'サービスアカウントのメールアドレス（Gmail収集用）' },
  { key: 'GCP_SA_PRIVATE_KEY', required: true, desc: 'サービスアカウントJSONの private_key（-----BEGIN...を含む全文）' },
  { key: 'LW_CLIENT_ID', required: true, desc: 'LINE WORKS アプリの Client ID' },
  { key: 'LW_CLIENT_SECRET', required: true, desc: 'LINE WORKS アプリの Client Secret' },
  { key: 'LW_SERVICE_ACCOUNT', required: true, desc: 'LINE WORKS Service Account ID（xxxx.serviceaccount@... 形式）' },
  { key: 'LW_PRIVATE_KEY', required: true, desc: 'LINE WORKS Service Account の秘密鍵（全文）' },
  { key: 'LW_DOMAIN_ID', required: true, desc: 'LINE WORKS のドメインID（モニタリングAPIで使用）' },
  { key: 'LW_BOT_ID', required: true, desc: '報告送信に使うBotのID' },
  { key: 'LW_PRESIDENT_USER_ID', required: true, desc: '経営者のLINE WORKSユーザーID（報告の送信先）' },
  { key: 'LW_ADMIN_USER_ID', required: false, desc: '管理者(DX担当)のユーザーID（エラー通知先）' },
  { key: 'ADMIN_EMAIL', required: false, desc: 'エラー通知のメール送信先（Bot通知が失敗したときの保険）' },
  { key: 'LINE_CHANNEL_ACCESS_TOKEN', required: false, desc: 'LINE公式アカウントのチャネルアクセストークン（表示名取得に使用）' },
  { key: 'LINE_WEBHOOK_TOKEN', required: false, desc: 'Webhook URLに付ける合言葉。?token=xxxx として登録する' },
  { key: 'GEMINI_API_KEY', required: true, desc: 'Gemini APIキー（従量課金を有効にしたプロジェクトのもの）' },
  { key: 'BIZ_SPREADSHEET_ID', required: false, desc: '既存の経営データ（売上・原価・課題）スプレッドシートのID' }
];

/** CONFIGシートの初期値（setupAll実行時に投入される） */
var CONFIG_DEFAULTS = [
  ['TIMEZONE', 'Asia/Tokyo', '日時の表示・集計に使うタイムゾーン'],
  ['ENABLE_GMAIL', 'TRUE', 'Gmail収集を行うか'],
  ['ENABLE_LINEWORKS', 'TRUE', 'LINE WORKSモニタリング収集を行うか'],
  ['ENABLE_LINE_OA', 'TRUE', 'LINE公式アカウントの受信データを報告に含めるか'],
  ['ENABLE_NOTIFY', 'TRUE', 'FALSEにすると生成のみで送信しない（試験運用向け）'],
  ['MAX_RUNTIME_MS', '270000', '1回の実行で使う上限ミリ秒。GASの6分制限に対する安全弁（4分30秒）'],
  ['MAX_MAIL_PER_TARGET', '100', '1メールアドレスあたり1日に取得する上限件数'],
  ['MAX_MAIL_ROWS_PER_DAY', '3000', 'DATA_MAILに1日で追記する上限行数'],
  ['MAX_TALK_ROWS_PER_DAY', '5000', 'DATA_TALKに1日で追記する上限行数'],
  ['MAX_LINE_ROWS_PER_DAY', '1000', 'DATA_LINEに1日で追記する上限行数'],
  ['MAX_AI_INPUT_CHARS', '60000', 'Geminiに渡す文字数の上限。超えた分は切り捨てる'],
  ['MAX_GEMINI_CALLS_PER_DAY', '5', '1日あたりのGemini呼び出し上限。暴走とコスト増を防ぐ'],
  ['REPORT_TARGET_OFFSET_DAYS', '1', '報告対象日。1なら「前日分」'],
  ['LW_MONITORING_LAG_DAYS', '0', 'モニタリングAPIのデータ生成待ちを見込んで対象日をさらに何日戻すか'],
  ['LW_MONITORING_MAX_DAYS', '31', 'モニタリングAPIの1回あたり最大取得日数（仕様上31日）'],
  ['LW_MONITORING_POLL_MAX', '10', 'CSV生成完了を待つ最大ポーリング回数'],
  ['LW_MONITORING_POLL_WAIT_MS', '5000', 'ポーリング間隔（ミリ秒）'],
  ['GEMINI_MODEL', 'gemini-2.5-flash', '使用するGeminiモデル名'],
  ['GEMINI_TEMPERATURE', '0.2', '生成のばらつき。経営報告なので低めが安全'],
  ['GEMINI_MAX_OUTPUT_TOKENS', '2048', '生成する最大トークン数'],
  ['SUMMARY_KEYWORDS',
    '見積,御見積,クレーム,苦情,至急,大至急,事故,契約,請求,入金,未払,遅延,騒音,近隣,発注,解約,督促,行政,監査,労災,トラブル,値引',
    'このいずれかを含むメール・トークを「要約対象」としてAIに渡す'],
  ['EXCLUDE_SENDER_KEYWORDS',
    'noreply,no-reply,donotreply,mailer-daemon,postmaster,notification',
    'この文字列を差出人アドレスに含むメールは収集しない（自動送信メール）'],
  ['TOP_ISSUE_COUNT', '3', '「対応が必要そうな事項」の件数'],
  ['NOTIFY_CHUNK_SIZE', '1800', 'LINE WORKS送信1通あたりの文字数。長い報告は分割送信する'],
  ['RUN_LOG_MAX_ROWS', '5000', 'RUN_LOGがこの行数を超えたら古い行から削除する'],
  ['BIZ_SALES_RANGE', '', '経営データ：売上の範囲（例 売上!A1:F30）。空なら読み込まない'],
  ['BIZ_COST_RANGE', '', '経営データ：原価の範囲（例 原価!A1:F30）'],
  ['BIZ_ISSUE_RANGE', '', '経営データ：課題の範囲（例 課題!A1:D30）'],
  ['LW_API_BASE', 'https://www.worksapis.com/v1.0', 'LINE WORKS APIのベースURL。仕様変更時はここを直す'],
  ['LW_AUTH_URL', 'https://auth.worksmobile.com/oauth2/v2.0/token', 'LINE WORKS 認証エンドポイント'],
  ['LW_MONITORING_PATH', '/monitoring/messages', 'モニタリングAPIのパス。公式ドキュメント改訂時はここを直す'],
  ['LW_CSV_COL_DATETIME', '送信日時,SendTime,sendTime,日時', 'CSVの日時列。候補をカンマ区切りで指定'],
  ['LW_CSV_COL_ROOM', 'トークルーム,ChannelName,channelName,ルーム名', 'CSVのトークルーム列'],
  ['LW_CSV_COL_SENDER', '送信者,SenderName,senderName,発言者', 'CSVの発言者名列'],
  ['LW_CSV_COL_SENDER_MAIL', '送信者アカウント,SenderEmail,senderEmail,アカウント', 'CSVの発言者アドレス列'],
  ['LW_CSV_COL_TEXT', '本文,Content,content,メッセージ', 'CSVの本文列'],
  ['LW_CSV_COL_ID', 'メッセージID,MessageId,messageId', 'CSVのメッセージID列']
];

/** CONFIG_ORG の初期値（法人名は導入時に書き換える） */
var CONFIG_ORG_DEFAULTS = [
  ['ORG_KAITAI', '（建設・解体法人の名前をここに）', '解体', 'example-kaitai.co.jp', '解体事業部', 'TRUE'],
  ['ORG_CHIIKI', '（地域支援法人の名前をここに）', '地域支援', 'example-chiiki.co.jp', '地域支援事業部', 'TRUE'],
  ['ORG_FUDOSAN', '（不動産法人の名前をここに）', '不動産', 'example-fudosan.co.jp', '不動産事業部', 'TRUE'],
  ['ORG_FUKUSHI', '（福祉法人の名前をここに）', '福祉', 'example-fukushi.or.jp', '福祉事業部', 'TRUE']
];

/** CONFIG_MAIL_TARGET の初期値（サンプル行。導入時に実アドレスへ差し替える） */
var CONFIG_MAIL_TARGET_DEFAULTS = [
  ['info@example-kaitai.co.jp', '解体：代表アドレス', 'ORG_KAITAI', '解体', 'FALSE'],
  ['president@example-kaitai.co.jp', '解体：代表取締役', 'ORG_KAITAI', '解体', 'FALSE']
];

/**
 * CONFIG_MASK の初期値。
 * 種別 regex … 正規表現。JavaScriptの正規表現として解釈する（gフラグ自動付与）
 * 種別 word  … 完全一致でない単純な文字列置換（氏名や施設名など）
 *
 * 【注意】売上・原価などの数値は伏せ字にしない。経営データは word ルールのみ適用する
 *        （maskBusinessText_ を参照）。
 */
var CONFIG_MASK_DEFAULTS = [
  ['regex', '0\\d{1,4}[-‐－ ]?\\d{1,4}[-‐－ ]?\\d{3,4}(?!\\d)', '【電話番号】', '固定電話・携帯番号', 'TRUE'],
  ['regex', '\\+81[-‐－ ]?\\d{1,4}[-‐－ ]?\\d{1,4}[-‐－ ]?\\d{3,4}', '【電話番号】', '国際表記の電話番号', 'TRUE'],
  ['regex', '[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}', '【メールアドレス】', 'メールアドレス', 'TRUE'],
  ['regex', '(?:口座|普通|当座|振込先)[^0-9]{0,8}\\d{6,8}', '【口座番号】', '口座番号（文脈つき）', 'TRUE'],
  ['regex', '\\d{4}[ \\-]?\\d{4}[ \\-]?\\d{4}(?!\\d)', '【個人番号等】', 'マイナンバー・カード番号に近い12桁', 'TRUE'],
  ['regex', '〒?\\d{3}[-‐－]\\d{4}', '【郵便番号】', '郵便番号', 'TRUE'],
  ['regex', '(?:19|20)\\d{2}[年/\\-]\\d{1,2}[月/\\-]\\d{1,2}日?生', '【生年月日】', '生年月日', 'TRUE'],
  ['word', '（要配慮情報の語をここに追加）', '【伏字】', '病名・障害名・利用者氏名などをここに1行ずつ追加する', 'FALSE']
];

// ------------------------------------------------------------------
// スクリプトプロパティ
// ------------------------------------------------------------------

function scriptProps_() {
  return PropertiesService.getScriptProperties();
}

/**
 * スクリプトプロパティを取得する。
 * @param {string} key キー名
 * @param {boolean} required trueかつ未設定なら例外を投げる
 * @return {string} 値（未設定なら空文字）
 */
function getProp_(key, required) {
  var v = scriptProps_().getProperty(key);
  if (v === null || v === '') {
    if (required) {
      throw new Error('スクリプトプロパティ ' + key + ' が未設定です。導入手順書の「スクリプトプロパティ一覧」を確認してください。');
    }
    return '';
  }
  return v;
}

/**
 * 秘密鍵は改行が \n という2文字で保存されることが多いため、実際の改行へ戻す。
 */
function getPrivateKeyProp_(key) {
  var raw = getProp_(key, true);
  return raw.replace(/\\n/g, '\n').trim();
}

// ------------------------------------------------------------------
// CONFIGシート
// ------------------------------------------------------------------

var CONFIG_CACHE_ = null;

/** データ基盤スプレッドシート（このスクリプトが紐づくファイル） */
function baseSpreadsheet_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

/** シートを取得する。存在しなければ例外（setupAll未実行の可能性） */
function sheet_(name) {
  var sh = baseSpreadsheet_().getSheetByName(name);
  if (!sh) {
    throw new Error('シート ' + name + ' が見つかりません。先に setupAll() を実行してください。');
  }
  return sh;
}

/** CONFIGシートをキー→値のオブジェクトとして読む（実行中はキャッシュ） */
function getConfigMap_() {
  if (CONFIG_CACHE_) return CONFIG_CACHE_;
  var values = sheet_(SHEET.CONFIG).getDataRange().getValues();
  var map = {};
  for (var i = 1; i < values.length; i++) {
    var key = String(values[i][0]).trim();
    if (!key) continue;
    map[key] = String(values[i][1]);
  }
  CONFIG_CACHE_ = map;
  return map;
}

/** テストや再読込用にキャッシュを捨てる */
function clearConfigCache_() {
  CONFIG_CACHE_ = null;
}

function cfg_(key, fallback) {
  var map = getConfigMap_();
  var v = map[key];
  if (v === undefined || v === '') {
    return fallback === undefined ? '' : fallback;
  }
  return v;
}

function cfgNum_(key, fallback) {
  var v = Number(cfg_(key, ''));
  return isNaN(v) || cfg_(key, '') === '' ? fallback : v;
}

function cfgBool_(key, fallback) {
  var v = String(cfg_(key, '')).trim().toUpperCase();
  if (v === '') return fallback;
  return v === 'TRUE' || v === '1' || v === 'はい' || v === 'ON';
}

/** カンマ区切りの設定値を配列にする */
function cfgList_(key) {
  return String(cfg_(key, ''))
    .split(',')
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s !== ''; });
}

function timezone_() {
  return cfg_('TIMEZONE', 'Asia/Tokyo');
}

// ------------------------------------------------------------------
// 法人・事業区分・収集対象
// ------------------------------------------------------------------

/**
 * CONFIG_ORG を読む。
 * @return {Array<{orgId, orgName, segment, domain, lwOrgName, enabled}>}
 */
function getOrganizations_() {
  var values = sheet_(SHEET.CONFIG_ORG).getDataRange().getValues();
  var list = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (!String(row[0]).trim()) continue;
    list.push({
      orgId: String(row[0]).trim(),
      orgName: String(row[1]).trim(),
      segment: String(row[2]).trim(),
      domain: String(row[3]).trim().toLowerCase(),
      lwOrgName: String(row[4]).trim(),
      enabled: String(row[5]).trim().toUpperCase() === 'TRUE'
    });
  }
  return list.filter(function (o) { return o.enabled; });
}

/** 事業区分の一覧（報告の見出しに使う） */
function getSegments_() {
  var seen = {};
  var list = [];
  getOrganizations_().forEach(function (o) {
    if (o.segment && !seen[o.segment]) {
      seen[o.segment] = true;
      list.push(o.segment);
    }
  });
  return list;
}

/** 社内ドメインの一覧 */
function getInternalDomains_() {
  return getOrganizations_().map(function (o) { return o.domain; }).filter(Boolean);
}

/**
 * メールアドレスのドメインから法人を引く。
 * @return {?object} 見つからなければ null
 */
function findOrgByAddress_(address) {
  var addr = String(address || '').toLowerCase();
  var at = addr.lastIndexOf('@');
  if (at < 0) return null;
  var domain = addr.slice(at + 1).replace(/>$/, '').trim();
  var orgs = getOrganizations_();
  for (var i = 0; i < orgs.length; i++) {
    if (orgs[i].domain && domain === orgs[i].domain) return orgs[i];
  }
  return null;
}

/**
 * CONFIG_MAIL_TARGET を読む。ここに書かれたアドレスだけをGmail収集の対象とする。
 * （全従業員を対象にしない＝最小権限の運用。増やしたい場合は行を足すだけでよい）
 */
function getMailTargets_() {
  var values = sheet_(SHEET.CONFIG_MAIL_TARGET).getDataRange().getValues();
  var list = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var email = String(row[0]).trim();
    if (!email) continue;
    if (String(row[4]).trim().toUpperCase() !== 'TRUE') continue;
    list.push({
      email: email,
      label: String(row[1]).trim(),
      orgId: String(row[2]).trim(),
      segment: String(row[3]).trim()
    });
  }
  return list;
}

/** CONFIG_MASK を読む */
function getMaskRules_() {
  var values = sheet_(SHEET.CONFIG_MASK).getDataRange().getValues();
  var rules = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var kind = String(row[0]).trim().toLowerCase();
    var pattern = String(row[1]);
    if (!kind || !pattern) continue;
    if (String(row[4]).trim().toUpperCase() !== 'TRUE') continue;
    rules.push({
      kind: kind,
      pattern: pattern,
      replacement: String(row[2]) || '【伏字】'
    });
  }
  return rules;
}
