/**
 * 09_Notify.gs
 * ------------------------------------------------------------------
 * LINE WORKS Bot での社内通知。
 *
 * 【設計原則1の実装】
 * 送信先は「経営者」と「管理者(DX担当)」の社内2箇所のみ。
 * 顧客・取引先など外部への送信経路はこのファイルに存在しない。
 * 返信機能も実装しない（第2期で承認フローとともに追加予定）。
 *
 * 長い報告は NOTIFY_CHUNK_SIZE 文字ごとに分割して連投する。
 * ------------------------------------------------------------------
 */

/**
 * 経営者へ報告を送る。
 * @param {string} text 送信本文
 * @return {string} 送信結果の説明（REPORT_LOGに残す）
 */
function notifyPresident_(text) {
  if (!cfgBool_('ENABLE_NOTIFY', true)) {
    return '未送信（CONFIGのENABLE_NOTIFYがFALSE）';
  }
  var userId = getProp_('LW_PRESIDENT_USER_ID', true);
  var chunks = splitForNotify_(text);
  chunks.forEach(function (chunk, i) {
    var label = chunks.length > 1 ? ('（' + (i + 1) + '/' + chunks.length + '）\n') : '';
    sendLineWorksMessage_(userId, label + chunk);
  });
  return '送信済み（' + chunks.length + '通）';
}

/**
 * 管理者(DX担当)へエラーを知らせる。
 * Botで送れなかった場合はメールへフォールバックする
 * （エラー通知そのものが届かない事態を避けるため）。
 */
function notifyAdmin_(subject, detail) {
  var body = '【経営AI管制塔】' + subject + '\n\n' + String(detail).slice(0, 2000);
  var sent = false;

  var adminId = getProp_('LW_ADMIN_USER_ID', false);
  if (adminId) {
    try {
      sendLineWorksMessage_(adminId, body);
      sent = true;
    } catch (e) {
      Logger.log('管理者へのBot通知に失敗: ' + e);
    }
  }

  if (!sent) {
    var mail = getProp_('ADMIN_EMAIL', false);
    if (mail) {
      try {
        MailApp.sendEmail(mail, '【経営AI管制塔】' + subject, body);
        sent = true;
      } catch (e2) {
        Logger.log('管理者へのメール通知に失敗: ' + e2);
      }
    }
  }
  return sent;
}

/**
 * LINE WORKS Bot API でユーザーへテキストを送る。
 * 送信先は社内ユーザーIDのみ。
 */
function sendLineWorksMessage_(userId, text) {
  var token = getLineWorksAccessToken_('bot');
  var base = cfg_('LW_API_BASE', 'https://www.worksapis.com/v1.0');
  var url = base + '/bots/' + encodeURIComponent(getProp_('LW_BOT_ID', true))
    + '/users/' + encodeURIComponent(userId) + '/messages';

  return fetchJson_(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ content: { type: 'text', text: text } })
  }, 'LINE WORKS Bot送信');
}

/**
 * 長文を分割する。行の途中で切れないように改行位置を優先する。
 */
function splitForNotify_(text) {
  var size = cfgNum_('NOTIFY_CHUNK_SIZE', 1800);
  var s = String(text || '');
  if (s.length <= size) return [s];

  var chunks = [];
  var rest = s;
  while (rest.length > size) {
    var cut = rest.lastIndexOf('\n', size);
    if (cut < size * 0.5) cut = size; // 改行が見つからなければ強制的に切る
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  if (rest) chunks.push(rest);
  return chunks;
}
