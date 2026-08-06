/**
 * 03_CollectGmail.gs
 * ------------------------------------------------------------------
 * Gmail の日次収集。
 *
 * 【方式】
 * サービスアカウント＋ドメイン全体の委任で、CONFIG_MAIL_TARGET に
 * 登録されたアドレスに1つずつなりすまし、前日分のメールを読む。
 * スコープは gmail.readonly のみ。送信・削除・ラベル変更は一切しない。
 *
 * 【保存するもの】
 * 日時 / 法人 / 事業区分 / 差出人 / 宛先 / 件名 / 要約対象フラグ / 抜粋
 * 本文全文はシートに保存しない（format=metadata で取得できる snippet のみ）。
 * 情報の持ちすぎを避けるためで、AIに渡すのもこの抜粋まで。
 *
 * 【要約対象フラグ】
 * CONFIG の SUMMARY_KEYWORDS のいずれかが件名または抜粋に含まれるとき TRUE。
 * TRUE の行だけがAIへの入力になる。判定基準を変えたいときは
 * コードではなく CONFIG シートの SUMMARY_KEYWORDS を編集する。
 *
 * 【6分制限への配慮】
 * 1アドレス＝1ジョブ。ジョブの合間に残り時間を確認し、足りなければ
 * 途中で中断して続きを次の実行に回す（10_Runner.gs が制御する）。
 * 明細取得は UrlFetchApp.fetchAll で20件ずつまとめて並列に取る。
 * ------------------------------------------------------------------
 */

var GMAIL_API_BASE_ = 'https://gmail.googleapis.com/gmail/v1/users/me';
var GMAIL_DETAIL_CHUNK_ = 20;

/**
 * 1アドレス分のメールを収集して DATA_MAIL に追記する。
 * @param {{email, label, orgId, segment}} target 収集対象
 * @param {{start: Date, end: Date, label: string}} range 対象期間
 * @param {{deadline: number}} budget 実行時間の締切（ミリ秒のエポック）
 * @return {{added: number, scanned: number}}
 */
function collectGmailForTarget_(target, range, budget) {
  var token = getGoogleAccessToken_(target.email);
  var headers = { Authorization: 'Bearer ' + token };

  var maxPerTarget = cfgNum_('MAX_MAIL_PER_TARGET', 100);
  var afterSec = Math.floor(range.start.getTime() / 1000);
  var beforeSec = Math.floor(range.end.getTime() / 1000);

  // --- 一覧取得（IDだけ集める） ---
  var ids = [];
  var pageToken = '';
  do {
    var url = GMAIL_API_BASE_ + '/messages'
      + '?q=' + encodeURIComponent('after:' + afterSec + ' before:' + beforeSec)
      + '&maxResults=' + Math.min(100, maxPerTarget)
      + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    var listRes = fetchJson_(url, { method: 'get', headers: headers }, 'Gmail messages.list(' + target.email + ')');
    (listRes.messages || []).forEach(function (m) { ids.push(m.id); });
    pageToken = listRes.nextPageToken || '';
  } while (pageToken && ids.length < maxPerTarget && Date.now() < budget.deadline);

  if (ids.length > maxPerTarget) ids = ids.slice(0, maxPerTarget);
  if (!ids.length) return { added: 0, scanned: 0 };

  // --- 既に取り込んだメッセージIDを除外 ---
  var known = loadKnownIds_(SHEET.MAIL, 11, 6000);
  ids = ids.filter(function (id) { return !known[id]; });
  if (!ids.length) return { added: 0, scanned: 0 };

  // --- 明細取得（メタデータのみ・並列） ---
  var org = findOrgById_(target.orgId);
  var keywords = cfgList_('SUMMARY_KEYWORDS');
  var excludes = cfgList_('EXCLUDE_SENDER_KEYWORDS');
  var now = formatDateTime_(new Date());
  var rows = [];
  var scanned = 0;

  for (var i = 0; i < ids.length; i += GMAIL_DETAIL_CHUNK_) {
    if (Date.now() > budget.deadline) break;
    var chunk = ids.slice(i, i + GMAIL_DETAIL_CHUNK_);
    var requests = chunk.map(function (id) {
      return {
        url: GMAIL_API_BASE_ + '/messages/' + id
          + '?format=metadata'
          + '&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc'
          + '&metadataHeaders=Subject&metadataHeaders=Date',
        method: 'get',
        headers: headers,
        muteHttpExceptions: true
      };
    });
    var responses = UrlFetchApp.fetchAll(requests);
    for (var j = 0; j < responses.length; j++) {
      scanned++;
      if (responses[j].getResponseCode() !== 200) continue;
      var msg = JSON.parse(responses[j].getContentText());
      var row = buildMailRow_(msg, target, org, keywords, excludes, now);
      if (row) rows.push(row);
    }
  }

  var added = appendWithDailyCap_(SHEET.MAIL, rows, cfgNum_('MAX_MAIL_ROWS_PER_DAY', 3000));
  return { added: added, scanned: scanned };
}

/**
 * Gmail APIの1件分のレスポンスを DATA_MAIL の1行に変換する。
 * 除外対象（自動送信メールなど）の場合は null を返す。
 */
function buildMailRow_(msg, target, org, keywords, excludes, fetchedAt) {
  var h = headerMap_(msg);
  var from = h['from'] || '';
  var fromAddress = extractAddress_(from);
  var fromName = extractDisplayName_(from);

  // 自動送信メールは収集しない
  var lowerFrom = fromAddress.toLowerCase();
  for (var i = 0; i < excludes.length; i++) {
    if (excludes[i] && lowerFrom.indexOf(excludes[i].toLowerCase()) >= 0) return null;
  }

  var subject = h['subject'] || '(件名なし)';
  var snippet = decodeHtmlEntities_(msg.snippet || '');
  var to = h['to'] || '';
  var cc = h['cc'] || '';
  var recipients = cc ? (to + ' / Cc: ' + cc) : to;

  var receivedAt = msg.internalDate
    ? formatDateTime_(new Date(Number(msg.internalDate)))
    : (h['date'] || '');

  var haystack = subject + ' ' + snippet;
  var isSummaryTarget = keywords.some(function (kw) { return kw && haystack.indexOf(kw) >= 0; });

  return [
    receivedAt,
    org ? org.orgName : target.orgId,
    target.segment || (org ? org.segment : ''),
    fromName,
    fromAddress,
    recipients,
    subject,
    isSummaryTarget ? 'TRUE' : 'FALSE',
    snippet,
    target.email,
    msg.id,
    fetchedAt
  ];
}

/** payload.headers を小文字キーの連想配列にする */
function headerMap_(msg) {
  var map = {};
  var headers = (msg.payload && msg.payload.headers) || [];
  headers.forEach(function (h) {
    map[String(h.name).toLowerCase()] = String(h.value || '');
  });
  return map;
}

/** "山田 太郎 <taro@example.com>" → "taro@example.com" */
function extractAddress_(value) {
  var m = String(value).match(/<([^>]+)>/);
  if (m) return m[1].trim();
  var m2 = String(value).match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/);
  return m2 ? m2[0] : String(value).trim();
}

/** "山田 太郎 <taro@example.com>" → "山田 太郎" */
function extractDisplayName_(value) {
  var s = String(value).replace(/<[^>]*>/, '').replace(/"/g, '').trim();
  return s || extractAddress_(value);
}

/** snippet に含まれる代表的なHTMLエンティティを戻す */
function decodeHtmlEntities_(text) {
  return String(text)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/** CONFIG_ORG から法人IDで引く */
function findOrgById_(orgId) {
  var orgs = getOrganizations_();
  for (var i = 0; i < orgs.length; i++) {
    if (orgs[i].orgId === orgId) return orgs[i];
  }
  return null;
}

// ------------------------------------------------------------------
// 重複排除と上限
// ------------------------------------------------------------------

/**
 * シート末尾から一定行数だけ読み、指定列のIDをセットにして返す。
 * 全行を読むと重くなるため、直近分だけを対象にする
 * （同じメールが何日も後に再取得されることは無いため実用上これで足りる）。
 *
 * @param {string} sheetName
 * @param {number} idColumn 1始まりの列番号
 * @param {number} lookbackRows さかのぼる行数
 */
function loadKnownIds_(sheetName, idColumn, lookbackRows) {
  var sh = sheet_(sheetName);
  var last = sh.getLastRow();
  if (last < 2) return {};
  var startRow = Math.max(2, last - lookbackRows + 1);
  var values = sh.getRange(startRow, idColumn, last - startRow + 1, 1).getValues();
  var set = {};
  values.forEach(function (r) {
    var id = String(r[0]).trim();
    if (id) set[id] = true;
  });
  return set;
}

/**
 * 1日の追記上限を超えないように追記する。
 * 上限に達した場合は RUN_LOG に「切り捨てた件数」を残す
 * （黙って捨てると「全部取れている」と誤解されるため）。
 */
function appendWithDailyCap_(sheetName, rows, dailyCap) {
  if (!rows.length) return 0;
  var todayCount = countRowsFetchedToday_(sheetName);
  var room = Math.max(0, dailyCap - todayCount);
  if (room <= 0) {
    logRun_('cap:' + sheetName, 'SKIP', 0, 0, '1日の上限 ' + dailyCap + ' 行に達したため ' + rows.length + ' 行を取り込みませんでした。');
    return 0;
  }
  if (rows.length > room) {
    logRun_('cap:' + sheetName, 'SKIP', room, 0, '1日の上限により ' + (rows.length - room) + ' 行を切り捨てました。');
    rows = rows.slice(0, room);
  }
  return appendRows_(sheetName, rows);
}

/** 「取得日時」列が今日のものを数える（各シートの最終列が取得日時） */
function countRowsFetchedToday_(sheetName) {
  var sh = sheet_(sheetName);
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var col = SHEET_HEADERS[sheetName].length; // 取得日時は最終列
  var lookback = Math.min(last - 1, 10000);
  var values = sh.getRange(last - lookback + 1, col, lookback, 1).getValues();
  var today = formatDate_(new Date());
  var n = 0;
  values.forEach(function (r) {
    if (cellToDateTimeString_(r[0]).indexOf(today) === 0) n++;
  });
  return n;
}
