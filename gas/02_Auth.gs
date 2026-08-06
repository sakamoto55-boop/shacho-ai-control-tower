/**
 * 02_Auth.gs
 * ------------------------------------------------------------------
 * 2種類のJWT認証をここに集約する。外部ライブラリは使わない
 * （DX担当1名で保守するため、依存を増やさない方針）。
 *
 *  1) Google サービスアカウント + ドメイン全体の委任
 *     → 指定したユーザーになりすまして Gmail API を「読むだけ」
 *  2) LINE WORKS Service Account
 *     → モニタリングAPI と Bot送信 のアクセストークン
 *
 * 取得したトークンは CacheService に短時間だけ保持し、
 * 実行のたびに認証しなおすムダを省く。
 * ------------------------------------------------------------------
 */

var GMAIL_SCOPE_ = 'https://www.googleapis.com/auth/gmail.readonly';
var GOOGLE_TOKEN_URL_ = 'https://oauth2.googleapis.com/token';

/** base64url エンコード（末尾の = を落とす） */
function base64UrlEncode_(input) {
  var bytes = (typeof input === 'string') ? Utilities.newBlob(input).getBytes() : input;
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

/**
 * RS256のJWTを作る。
 * @param {object} claim ペイロード
 * @param {string} privateKey PEM形式の秘密鍵
 */
function buildJwtRs256_(claim, privateKey) {
  var header = { alg: 'RS256', typ: 'JWT' };
  var signingInput = base64UrlEncode_(JSON.stringify(header)) + '.' + base64UrlEncode_(JSON.stringify(claim));
  var signature = Utilities.computeRsaSha256Signature(signingInput, privateKey);
  return signingInput + '.' + base64UrlEncode_(signature);
}

// ------------------------------------------------------------------
// Google（Gmail読み取り）
// ------------------------------------------------------------------

/**
 * 指定ユーザーになりすましたアクセストークンを取得する。
 * ドメイン全体の委任が管理コンソールで許可されていないと 401/403 になる。
 *
 * @param {string} userEmail なりすまし対象（CONFIG_MAIL_TARGETのアドレス）
 * @return {string} アクセストークン
 */
function getGoogleAccessToken_(userEmail) {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'gtoken:' + userEmail;
  var cached = cache.get(cacheKey);
  if (cached) return cached;

  var now = Math.floor(Date.now() / 1000);
  var claim = {
    iss: getProp_('GCP_SA_CLIENT_EMAIL', true),
    sub: userEmail, // ← ここがドメイン全体の委任の肝。なりすまし対象
    scope: GMAIL_SCOPE_,
    aud: GOOGLE_TOKEN_URL_,
    iat: now,
    exp: now + 3600
  };
  var jwt = buildJwtRs256_(claim, getPrivateKeyProp_('GCP_SA_PRIVATE_KEY'));

  var res = UrlFetchApp.fetch(GOOGLE_TOKEN_URL_, {
    method: 'post',
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    },
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code !== 200) {
    throw new Error(
      'Googleのアクセストークン取得に失敗しました（' + userEmail + ' / HTTP ' + code + '）。' +
      'ドメイン全体の委任の設定とスコープ gmail.readonly を確認してください。応答: ' + body.slice(0, 300)
    );
  }
  var json = JSON.parse(body);
  // 有効期限より少し短くキャッシュする
  cache.put(cacheKey, json.access_token, 3000);
  return json.access_token;
}

// ------------------------------------------------------------------
// LINE WORKS
// ------------------------------------------------------------------

/**
 * LINE WORKS のアクセストークンを取得する。
 * scope はスペース区切りで複数指定できる（例: 'monitoring.read bot'）。
 *
 * @param {string} scope 必要なスコープ
 * @return {string} アクセストークン
 */
function getLineWorksAccessToken_(scope) {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'lwtoken:' + scope;
  var cached = cache.get(cacheKey);
  if (cached) return cached;

  var clientId = getProp_('LW_CLIENT_ID', true);
  var clientSecret = getProp_('LW_CLIENT_SECRET', true);
  var serviceAccount = getProp_('LW_SERVICE_ACCOUNT', true);
  var privateKey = getPrivateKeyProp_('LW_PRIVATE_KEY');

  var now = Math.floor(Date.now() / 1000);
  var claim = {
    iss: clientId,
    sub: serviceAccount,
    iat: now,
    exp: now + 3600
  };
  var jwt = buildJwtRs256_(claim, privateKey);

  var res = UrlFetchApp.fetch(cfg_('LW_AUTH_URL', 'https://auth.worksmobile.com/oauth2/v2.0/token'), {
    method: 'post',
    payload: {
      assertion: jwt,
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      client_id: clientId,
      client_secret: clientSecret,
      scope: scope
    },
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code !== 200) {
    throw new Error(
      'LINE WORKSのアクセストークン取得に失敗しました（scope=' + scope + ' / HTTP ' + code + '）。' +
      'Developer Consoleでスコープが許可されているか確認してください。応答: ' + body.slice(0, 300)
    );
  }
  var json = JSON.parse(body);
  cache.put(cacheKey, json.access_token, 3000);
  return json.access_token;
}

// ------------------------------------------------------------------
// 共通のHTTPヘルパ
// ------------------------------------------------------------------

/**
 * JSONを返すAPIを叩く。失敗時は分かりやすい例外にして投げ直す。
 * 429/5xx は指数バックオフで最大3回まで再試行する。
 */
function fetchJson_(url, options, label) {
  var opts = options || {};
  opts.muteHttpExceptions = true;
  var attempt = 0;
  var wait = 1000;
  while (true) {
    attempt++;
    var res = UrlFetchApp.fetch(url, opts);
    var code = res.getResponseCode();
    var text = res.getContentText();
    if (code >= 200 && code < 300) {
      return text ? JSON.parse(text) : {};
    }
    var retriable = (code === 429 || code >= 500);
    if (retriable && attempt < 3) {
      Utilities.sleep(wait);
      wait *= 2;
      continue;
    }
    throw new Error((label || 'API') + ' 呼び出しに失敗（HTTP ' + code + '）: ' + text.slice(0, 400));
  }
}
