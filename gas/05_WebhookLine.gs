/**
 * 05_WebhookLine.gs
 * ------------------------------------------------------------------
 * LINE公式アカウント（Messaging API）のWebhook受信。
 *
 * 【できないことの明記】
 * ★ 過去のトーク履歴は取得できません。
 *   Messaging APIには「過去のメッセージを一覧する」APIが存在しないため、
 *   このWebhookを登録した時点より後に届いたメッセージだけが蓄積されます。
 *   運用開始前のやり取りは、必要であれば人が転記してください。
 *
 * ★ 署名（x-line-signature）の検証はできません。
 *   GASの doPost(e) にはHTTPリクエストヘッダーが渡されない仕様のため、
 *   LINEが推奨する署名検証を実装する手段がありません。
 *   代わりに以下で最低限の防御をしています。
 *     1) WebhookのURLに合言葉（?token=...）を付け、一致しない要求は捨てる
 *     2) LINEのWebhook形式（destination と events 配列）でない要求は捨てる
 *   合言葉はスクリプトプロパティ LINE_WEBHOOK_TOKEN に入れ、
 *   URLを公開しない運用としてください。
 *
 * 【送信はしません】
 * 返信・プッシュ送信は一切実装していません。読み取りと蓄積のみです。
 * ------------------------------------------------------------------
 */

/** キュー退避用のプロパティキー（シートがロックされていた場合の保険） */
var LINE_QUEUE_PROP_ = 'LINE_PENDING_EVENTS';

/**
 * Webhookの受信口。
 * LINEは短時間での200応答を期待するため、重い処理はここでしない。
 */
function doPost(e) {
  try {
    // 1) 合言葉の確認
    var expected = getProp_('LINE_WEBHOOK_TOKEN', false);
    if (expected) {
      var given = (e && e.parameter && e.parameter.token) || '';
      if (given !== expected) {
        logRun_('webhook:line', 'SKIP', 0, 0, '合言葉が一致しない要求を破棄しました。');
        return jsonOutput_({ ok: false });
      }
    }

    // 2) 形式の確認
    var body = (e && e.postData && e.postData.contents) ? JSON.parse(e.postData.contents) : {};
    var events = body.events;
    if (!events || !events.length) {
      // LINEの疎通確認（Verify）は空のeventsで来る。正常応答を返す
      return jsonOutput_({ ok: true });
    }

    var rows = events.map(buildLineRow_).filter(function (r) { return r; });
    if (!rows.length) return jsonOutput_({ ok: true });

    // 3) 追記。ロックが取れなければ捨てずにキューへ退避する
    //    （日次バッチが動いている最中に届いても取りこぼさないため）
    var written = runWithScriptLock_(3000, function () {
      appendLineRows_(rows);
    });
    if (!written) queueLineRows_(rows);
    return jsonOutput_({ ok: true });
  } catch (err) {
    // 失敗してもLINE側にはエラーを返さない（再送の嵐を避けるため）
    try {
      logRun_('webhook:line', 'ERROR', 0, 0, String(err));
    } catch (e2) { /* ログ失敗は握りつぶす */ }
    return jsonOutput_({ ok: false });
  }
}

/** 稼働確認用。ブラウザでWebアプリURLを開くと表示される */
function doGet() {
  return ContentService.createTextOutput('経営AI管制塔 Webhook: 稼働中');
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * LINEのイベント1件を DATA_LINE の1行に変換する。
 * テキスト以外（スタンプ・画像など）は種別だけ残す。
 */
function buildLineRow_(event) {
  if (!event || event.type !== 'message') return null;
  var msg = event.message || {};
  var when = event.timestamp ? new Date(Number(event.timestamp)) : new Date();
  var userId = (event.source && event.source.userId) || '';

  var text;
  if (msg.type === 'text') {
    text = String(msg.text || '');
  } else {
    text = '（' + (msg.type || '不明') + 'の受信）';
  }

  return [
    formatDateTime_(when),
    '', // 顧客名は後から enrichLineProfiles_ で補完する
    userId,
    text,
    msg.type || '',
    String(event.webhookEventId || msg.id || ''),
    formatDateTime_(new Date())
  ];
}

/** DATA_LINE へ重複を避けて追記する */
function appendLineRows_(rows) {
  var known = loadKnownIds_(SHEET.LINE, 6, 3000);
  var fresh = rows.filter(function (r) {
    var id = String(r[5]);
    if (!id) return true;
    if (known[id]) return false;
    known[id] = true;
    return true;
  });
  if (!fresh.length) return 0;
  return appendWithDailyCap_(SHEET.LINE, fresh, cfgNum_('MAX_LINE_ROWS_PER_DAY', 1000));
}

/** シートに書けなかった行をスクリプトプロパティへ退避する */
function queueLineRows_(rows) {
  var props = scriptProps_();
  var current = props.getProperty(LINE_QUEUE_PROP_);
  var list = current ? JSON.parse(current) : [];
  list = list.concat(rows);
  // プロパティは9KB/件の制限があるため、あふれる場合は古いものから捨てる
  while (JSON.stringify(list).length > 8000 && list.length > 1) {
    list.shift();
  }
  props.setProperty(LINE_QUEUE_PROP_, JSON.stringify(list));
}

/**
 * 退避しておいた行をシートへ書き出す。
 * 毎日03:30のトリガーと、収集ジョブの先頭で呼ばれる。
 */
function flushLineQueue() {
  var started = Date.now();
  var props = scriptProps_();
  var current = props.getProperty(LINE_QUEUE_PROP_);
  if (!current) return 0;
  var rows = JSON.parse(current);
  props.deleteProperty(LINE_QUEUE_PROP_);
  var n = appendLineRows_(rows);
  logRun_('line:flush', 'OK', n, Date.now() - started, '退避分を書き出しました。');
  return n;
}

/**
 * 顧客名（LINEの表示名）を後から補う。
 * Webhookの応答を速く保つため、受信時ではなく日次バッチで取得する。
 * profile APIは読み取り専用。チャネルアクセストークン未設定なら何もしない。
 */
function enrichLineProfiles_(budget) {
  var token = getProp_('LINE_CHANNEL_ACCESS_TOKEN', false);
  if (!token) return 0;

  var sh = sheet_(SHEET.LINE);
  var last = sh.getLastRow();
  if (last < 2) return 0;

  var lookback = Math.min(last - 1, 500);
  var startRow = last - lookback + 1;
  var values = sh.getRange(startRow, 1, lookback, SHEET_HEADERS[SHEET.LINE].length).getValues();

  var cache = {};
  var updated = 0;
  for (var i = 0; i < values.length; i++) {
    if (budget && Date.now() > budget.deadline) break;
    var name = String(values[i][1]).trim();
    var userId = String(values[i][2]).trim();
    if (name || !userId) continue;

    if (cache[userId] === undefined) {
      cache[userId] = fetchLineDisplayName_(userId, token);
    }
    if (cache[userId]) {
      sh.getRange(startRow + i, 2).setValue(cache[userId]);
      updated++;
    }
  }
  return updated;
}

function fetchLineDisplayName_(userId, token) {
  try {
    var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/profile/' + encodeURIComponent(userId), {
      method: 'get',
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) return '';
    return String(JSON.parse(res.getContentText()).displayName || '');
  } catch (e) {
    return '';
  }
}
