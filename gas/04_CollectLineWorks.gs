/**
 * 04_CollectLineWorks.gs
 * ------------------------------------------------------------------
 * LINE WORKS トークの日次収集（モニタリングAPI / monitoring.read）。
 *
 * 【重要な前提】
 * - モニタリングAPIは「リアルタイム取得はできない」。
 *   期間を指定してCSVを作らせ、それをダウンロードする方式。
 * - 1回に指定できる期間は最長31日（CONFIG: LW_MONITORING_MAX_DAYS）。
 * - CSVの生成には時間がかかることがあるため、完成するまでポーリングする。
 * - 前日分がまだ生成されていないことがある。その場合は空振りになるので、
 *   CONFIG の LW_MONITORING_LAG_DAYS を 1 にして「2日前」を取りにいく運用へ
 *   切り替えられるようにしてある。
 *
 * 【仕様変更への備え】
 * LINE WORKS APIのエンドポイントやCSVの列名は改訂されることがある。
 * URL・パス・CSV列名はすべて CONFIG シートから読むようにしてあるので、
 * 変更があってもコードを直さず CONFIG の値を直せば追随できる。
 * （公式ドキュメントで最新のパラメータ名を必ず確認すること）
 *
 * 【やらないこと】
 * 送信・既読処理・トークの変更は一切行わない。読むだけ。
 * ------------------------------------------------------------------
 */

/**
 * LINE WORKSのトークを収集して DATA_TALK に追記する。
 * @param {{start: Date, end: Date, label: string}} range 対象期間
 * @param {{deadline: number}} budget 実行時間の締切
 * @return {{added: number, scanned: number}}
 */
function collectLineWorksTalks_(range, budget) {
  var token = getLineWorksAccessToken_('monitoring.read');
  var downloadUrl = requestMonitoringCsv_(token, range, budget);
  if (!downloadUrl) {
    throw new Error('モニタリングAPIのCSVダウンロードURLを取得できませんでした。対象期間のデータがまだ生成されていない可能性があります（CONFIG の LW_MONITORING_LAG_DAYS を 1 にして翌日取得へ切り替えてください）。');
  }

  var table = downloadCsvTable_(downloadUrl, token);
  if (!table.length) return { added: 0, scanned: 0 };

  var header = table[0].map(function (c) { return String(c).trim(); });
  var idx = {
    datetime: findColumnIndex_(header, cfgList_('LW_CSV_COL_DATETIME')),
    room: findColumnIndex_(header, cfgList_('LW_CSV_COL_ROOM')),
    sender: findColumnIndex_(header, cfgList_('LW_CSV_COL_SENDER')),
    senderMail: findColumnIndex_(header, cfgList_('LW_CSV_COL_SENDER_MAIL')),
    text: findColumnIndex_(header, cfgList_('LW_CSV_COL_TEXT')),
    id: findColumnIndex_(header, cfgList_('LW_CSV_COL_ID'))
  };
  if (idx.datetime < 0 || idx.text < 0) {
    throw new Error(
      'モニタリングCSVの列を特定できませんでした。実際の見出しは [' + header.join(' | ') + '] です。' +
      'CONFIG の LW_CSV_COL_* にこの見出し名を追記してください。'
    );
  }

  var known = loadKnownIds_(SHEET.TALK, 7, 8000);
  var now = formatDateTime_(new Date());
  var rows = [];
  var scanned = 0;

  for (var i = 1; i < table.length; i++) {
    if (Date.now() > budget.deadline) break;
    scanned++;
    var raw = table[i];
    if (!raw || raw.length < 2) continue;

    var when = parseLooseDate_(pick_(raw, idx.datetime));
    if (!when) continue;
    // CSVが対象日より広い期間を含むことがあるため、ここで期間を絞る
    if (when.getTime() < range.start.getTime() || when.getTime() >= range.end.getTime()) continue;

    var text = String(pick_(raw, idx.text) || '').trim();
    if (!text) continue; // スタンプ・ファイルのみの行は本文が空。分析対象にしない

    var senderMail = String(pick_(raw, idx.senderMail) || '').trim();
    var room = String(pick_(raw, idx.room) || '').trim();
    var msgId = String(pick_(raw, idx.id) || '').trim()
      || sha256Hex_([formatDateTime_(when), room, senderMail, text].join('|'));
    if (known[msgId]) continue;
    known[msgId] = true;

    rows.push([
      formatDateTime_(when),
      resolveTalkOrgName_(senderMail, room),
      room,
      String(pick_(raw, idx.sender) || '').trim(),
      senderMail,
      text,
      msgId,
      now
    ]);
  }

  var added = appendWithDailyCap_(SHEET.TALK, rows, cfgNum_('MAX_TALK_ROWS_PER_DAY', 5000));
  return { added: added, scanned: scanned };
}

/**
 * モニタリングCSVの生成を依頼し、ダウンロードURLを得る。
 * 応答の形はAPIのバージョンによって differ するため、
 * 「URLがすぐ返る」「ジョブIDが返るのでポーリングする」の両方に対応する。
 */
function requestMonitoringCsv_(token, range, budget) {
  var base = cfg_('LW_API_BASE', 'https://www.worksapis.com/v1.0');
  var path = cfg_('LW_MONITORING_PATH', '/monitoring/messages');
  var maxDays = cfgNum_('LW_MONITORING_MAX_DAYS', 31);

  // 期間は最長31日。日次運用では1日だが、取りこぼしの手動リカバリで広げられる
  var spanMs = range.end.getTime() - range.start.getTime();
  if (spanMs > maxDays * 86400000) {
    throw new Error('モニタリングAPIに指定できる期間は最長 ' + maxDays + ' 日です。');
  }

  var url = base + path
    + '?domainId=' + encodeURIComponent(getProp_('LW_DOMAIN_ID', true))
    + '&startTime=' + encodeURIComponent(toIso8601_(range.start))
    + '&endTime=' + encodeURIComponent(toIso8601_(new Date(range.end.getTime() - 1000)))
    + '&language=ja'
    + '&botMessage=true';

  var res = fetchJson_(url, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + token }
  }, 'LINE WORKS モニタリングAPI');

  var direct = extractDownloadUrl_(res);
  if (direct) return direct;

  var jobId = res.id || res.jobId || res.requestId || (res.data && res.data.id);
  if (!jobId) return '';

  // --- 生成完了までポーリング ---
  var maxPoll = cfgNum_('LW_MONITORING_POLL_MAX', 10);
  var waitMs = cfgNum_('LW_MONITORING_POLL_WAIT_MS', 5000);
  for (var i = 0; i < maxPoll; i++) {
    if (Date.now() + waitMs > budget.deadline) {
      throw new Error('モニタリングCSVの生成待ちで実行時間の上限に達しました。次回の実行で再試行されます。');
    }
    Utilities.sleep(waitMs);
    var poll = fetchJson_(base + path + '/' + encodeURIComponent(jobId), {
      method: 'get',
      headers: { Authorization: 'Bearer ' + token }
    }, 'LINE WORKS モニタリングAPI(状態確認)');
    var u = extractDownloadUrl_(poll);
    if (u) return u;
    var status = String(poll.status || poll.state || '').toUpperCase();
    if (status === 'FAILED' || status === 'ERROR') {
      throw new Error('モニタリングCSVの生成に失敗しました（status=' + status + '）。');
    }
  }
  return '';
}

/** 応答のどこかにあるダウンロードURLを拾う */
function extractDownloadUrl_(res) {
  if (!res) return '';
  var candidates = [res.downloadUrl, res.downloadURL, res.url, res.fileUrl];
  if (res.data) {
    candidates = candidates.concat([res.data.downloadUrl, res.data.url]);
  }
  for (var i = 0; i < candidates.length; i++) {
    if (candidates[i]) return String(candidates[i]);
  }
  return '';
}

/**
 * CSVをダウンロードして二次元配列にする。
 * ZIPで返ってくる場合は展開し、中の最初のCSVを読む。
 * 文字コードはUTF-8想定だが、BOM付き・Shift_JISのどちらでも読めるようにしている。
 */
function downloadCsvTable_(url, token) {
  var res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('モニタリングCSVのダウンロードに失敗しました（HTTP ' + res.getResponseCode() + '）。');
  }

  var blob = res.getBlob();
  var contentType = String(blob.getContentType() || '');
  if (contentType.indexOf('zip') >= 0 || /\.zip($|\?)/i.test(url)) {
    var files = Utilities.unzip(blob.setContentType('application/zip'));
    var csv = files.filter(function (f) { return /\.csv$/i.test(f.getName()); })[0] || files[0];
    if (!csv) throw new Error('ZIPの中にCSVが見つかりませんでした。');
    blob = csv;
  }

  var text = safeBlobToText_(blob);
  return Utilities.parseCsv(text);
}

/** UTF-8で読めなければShift_JISで読み直す */
function safeBlobToText_(blob) {
  var text;
  try {
    text = blob.getDataAsString('UTF-8');
  } catch (e) {
    text = '';
  }
  // 文字化けの簡易判定（置換文字が多すぎる場合はShift_JISとみなす）
  var garbled = (text.match(/�/g) || []).length;
  if (!text || garbled > 10) {
    try {
      text = blob.getDataAsString('Shift_JIS');
    } catch (e2) {
      // 読めなければUTF-8の結果をそのまま使う
    }
  }
  return text.replace(/^﻿/, '');
}

/** 候補の見出し名からCSVの列番号を探す。見つからなければ -1 */
function findColumnIndex_(header, candidates) {
  for (var i = 0; i < candidates.length; i++) {
    var idx = header.indexOf(candidates[i]);
    if (idx >= 0) return idx;
  }
  // 大文字小文字・空白を無視した緩い一致も試す
  var normalized = header.map(function (h) { return h.toLowerCase().replace(/\s/g, ''); });
  for (var j = 0; j < candidates.length; j++) {
    var key = candidates[j].toLowerCase().replace(/\s/g, '');
    var k = normalized.indexOf(key);
    if (k >= 0) return k;
  }
  return -1;
}

function pick_(row, index) {
  return index >= 0 && index < row.length ? row[index] : '';
}

/** 発言者のアドレス、なければトークルーム名から法人を推定する */
function resolveTalkOrgName_(senderMail, roomName) {
  var org = findOrgByAddress_(senderMail);
  if (org) return org.orgName;
  var orgs = getOrganizations_();
  for (var i = 0; i < orgs.length; i++) {
    if (orgs[i].lwOrgName && String(roomName).indexOf(orgs[i].lwOrgName) >= 0) {
      return orgs[i].orgName;
    }
  }
  return '不明';
}

/**
 * ISO8601（秒まで＋タイムゾーン）に整形する。例 2026-08-05T00:00:00+09:00
 * SimpleDateFormat の X 指定子は環境によって使えないため、
 * +0900 形式を取得してからコロンを挿入している。
 */
function toIso8601_(date) {
  var body = Utilities.formatDate(date, timezone_(), "yyyy-MM-dd'T'HH:mm:ss");
  var offset = Utilities.formatDate(date, timezone_(), 'Z'); // 例 +0900
  return body + offset.slice(0, 3) + ':' + offset.slice(3);
}

/**
 * CSVの日時文字列を Date にする。
 * "2026-08-05 09:12:34" "2026/08/05 9:12" "2026-08-05T09:12:34+09:00" などに対応。
 */
function parseLooseDate_(value) {
  var s = String(value || '').trim();
  if (!s) return null;
  var normalized = s.replace(/\//g, '-');
  var d = new Date(normalized);
  if (!isNaN(d.getTime())) return d;
  // タイムゾーン表記がない場合はスクリプトのタイムゾーンとして解釈し直す
  var m = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  var iso = m[1] + '/' + pad2_(m[2]) + '/' + pad2_(m[3]) + ' '
    + pad2_(m[4]) + ':' + m[5] + ':' + (m[6] || '00') + ' '
    + Utilities.formatDate(new Date(), timezone_(), 'ZZZZ');
  var d2 = new Date(iso);
  return isNaN(d2.getTime()) ? null : d2;
}

function pad2_(v) {
  return ('0' + String(v)).slice(-2);
}

/** 文字列のSHA-256を16進で返す（IDのない行の重複排除に使う） */
function sha256Hex_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    return ('0' + (b & 0xff).toString(16)).slice(-2);
  }).join('');
}
