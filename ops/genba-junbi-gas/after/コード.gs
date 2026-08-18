/**
 * 現場準備依頼台帳 + info@lcc55.com 共有受信箱 — GASウェブアプリ版
 *
 * ローカルNode版 (OneDrive\ドキュメント\New project\server.js) の移植。
 * データの正本は Googleスプレッドシート (setup() が自動作成)。
 * PCを起動していなくてもスマホから使えるようにするための版。
 *
 * 初回セットアップ:
 *   1. setup() をエディタから実行 (権限承認 → データ用スプレッドシート作成 + 初期データ取込)
 *   2. デプロイ → ウェブアプリ → アクセスできるユーザー「lcc55.com内の全員」
 *   3. 最終切替時のみ enableMorningNotify() を実行 (毎朝7:30通知。PC版と二重になるため並走中は実行しない)
 *
 * 現行PC版と並走安全:
 *   - LINEWORKS受信箱シートは読むだけ (「取得状態」列は触らない。PC版のポーリングを壊さない)
 *   - 自分が取り込んだ分は自前の「状態」シートの processedIds で管理
 */

// ============================== 設定 ==============================

var DEFAULT_CONFIG = {
  LINEWORKS_WEBHOOK_URL: "https://webhook.worksmobile.com/message/3e2040a1-b8d8-46fb-973e-10c0b5fc7d70",
  LINEWORKS_WEBHOOK_FORMAT: "",
  LINEWORKS_INBOX_SHEET_ID: "1T-aLFFNzOGEIgnT6xsHcB5SxrVNJFYWZZi1Och7NidM",
  LINEWORKS_INBOX_SHEET_NAME: "lineworks_inbox",
  GMAIL_QUERY: "{to:info@lcc55.com deliveredto:info@lcc55.com} newer_than:14d -in:spam -in:trash",
  GMAIL_MAX_RESULTS: "200"
};

var DATA_SPREADSHEET_NAME = "マニフェスト依頼台帳データ(GAS版)";
var IMPORT_FOLDER_NAME = "マニフェスト台帳GAS化データ";

var SHEET_MANIFESTS = "台帳";
var SHEET_MAIL = "メール";
var SHEET_INTAKE = "受信箱";
var SHEET_USERS = "ユーザー";
var SHEET_CONFIG = "設定";
var SHEET_STATE = "状態";

var MANIFEST_HEADERS = ["id", "requestType", "siteName", "siteAddress", "contractorName", "mapStatus", "requestSource", "startDate", "neededDate", "copies", "manifestKind", "manifestBreakdown", "sourceRoom", "generator", "transporter", "destination", "wasteNumber", "wasteTypes", "quantity", "unit", "status", "priority", "owner", "requestedBy", "lineworksText", "notes", "createdAt", "updatedAt", "completedAt", "handedOffAt", "history"];
var MAIL_HEADERS = ["id", "gmailId", "threadId", "subject", "from", "receivedAt", "updatedAt", "category", "status", "assignee", "priority", "dueDate", "excerpt", "actionSummary", "notes", "history", "source", "gmailUrl"];
var INTAKE_HEADERS = ["id", "receivedAt", "postedAt", "room", "sender", "text", "parsed", "warnings", "duplicateCandidates"];

var MANIFEST_JSON_KEYS = { history: true };
var MAIL_JSON_KEYS = { notes: true, history: true };
var INTAKE_JSON_KEYS = { parsed: true, warnings: true, duplicateCandidates: true };
var DATE_ONLY_KEYS = { startDate: true, neededDate: true, dueDate: true };

var statusOptions = ["未作成", "作成中", "作成済み", "受渡済み", "不要/保留"];
var priorityOptions = ["高", "中", "低"];
var requestTypeOptions = ["マニフェスト", "道具・備品"];
var manifestKindOptions = ["紙マニフェスト", "電子マニフェスト", "追加マニフェスト", "マニフェスト表", "道具・備品"];

var mailStatusOptions = ["未対応", "対応中", "返信待ち", "完了", "対応不要"];
var mailPriorityOptions = ["高", "中", "低"];
var mailCategoryOptions = ["案件", "請求・契約", "採用・人事", "システム通知", "営業・メルマガ", "その他"];

// ============================== エントリポイント ==============================

function doGet(e) {

  var page = e && e.parameter ? String(e.parameter.page || "") : "";
  var name = page === "mail" ? "Mail" : page === "flow" ? "Flow" : "Index";
  var template = HtmlService.createTemplateFromFile(name);
  template.baseUrl = webAppUrl();
  return template.evaluate()
    .setTitle(page === "mail" ? "info@lcc55.com 共有受信箱" : page === "flow" ? "業務の全体像" : "現場準備依頼台帳")
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

function webAppUrl() {
  // 正式な公開URLを固定で返す（getService().getUrl()は別デプロイの無効URLを返すことがあるため使わない）
  return "https://script.google.com/macros/s/AKfycbycEL8tEkMPi6DIfxDEESGB1CBpGyHJrsLmGUeaD0PbJyiWEoQpnTPBzHHRUwwSwmSb/exec";
}

function shareUrls() {
  var base = webAppUrl();
  return base ? [base, base + "?page=mail"] : [];
}

/**
 * クライアント(google.script.run)からの唯一の入口。
 * ローカル版のHTTPルーティングをそのまま写している。
 */
function apiDispatch(route, method, bodyJson) {
  try {
    var body = bodyJson ? JSON.parse(bodyJson) : {};
    var result = handleApi(String(route || ""), String(method || "GET").toUpperCase(), body);
    return JSON.stringify(result === undefined ? {} : result);
  } catch (error) {
    return JSON.stringify({
      __error: (error && error.message) || "処理に失敗しました。",
      __status: (error && error.statusCode) || 400,
      ticket: error && error.ticket ? error.ticket : undefined
    });
  }
}

function handleApi(route, method, body) {
  var m;

  // ---- メール共有受信箱 ----
  if (route === "/api/mail/bootstrap" && method === "GET") {
    // 注意: ここでGmail取込を同期実行しない。取込(最大数分)が終わるまで画面が
    // 全件0・「確認中」のまま固まる不具合の原因だった。取込は表示後に
    // /api/mail/gmail/auto をクライアントが裏で呼ぶ方式に変更。
    var mailTickets = readMailTickets();
    return {
      tickets: mailTickets,
      summary: buildMailSummary(mailTickets),
      shareUrls: shareUrls(),
      statusOptions: mailStatusOptions,
      priorityOptions: mailPriorityOptions,
      categoryOptions: mailCategoryOptions,
      gmail: mailGmailDiagnostics()
    };
  }
  if (route === "/api/mail/summary" && method === "GET") return buildMailSummary();
  if (route === "/api/mail/gmail/diagnostics" && method === "GET") return mailGmailDiagnostics();
  if (route === "/api/mail/gmail/import" && method === "POST") return withLock(function () { return importMailFromGmail(); });
  if (route === "/api/mail/gmail/auto" && method === "POST") {
    // 画面表示後にクライアントが裏で呼ぶ。30分未経過なら何もしない。
    var autoImport = maybeAutoImportGmail();
    return { ran: Boolean(autoImport), created: autoImport ? autoImport.created || 0 : 0 };
  }
  if (route === "/api/mail/invite.txt" && method === "GET") return { text: buildMailInviteText() };
  if (route === "/api/mail/tickets" && method === "POST") {
    return withLock(function () {
      var ticket = addMailTicket(body);
      return { ticket: ticket, summary: buildMailSummary() };
    });
  }
  m = route.match(/^\/api\/mail\/tickets\/([^/]+)\/notes$/);
  if (m && method === "POST") {
    var noteId = decodeURIComponent(m[1]);
    return withLock(function () {
      var ticket = addMailTicketNote(noteId, body);
      return { ticket: ticket, summary: buildMailSummary() };
    });
  }
  m = route.match(/^\/api\/mail\/tickets\/([^/]+)$/);
  if (m && method === "PATCH") {
    var patchId = decodeURIComponent(m[1]);
    return withLock(function () {
      var ticket = updateMailTicket(patchId, body);
      return { ticket: ticket, summary: buildMailSummary() };
    });
  }
  if (m && method === "DELETE") {
    var deleteId = decodeURIComponent(m[1]);
    return withLock(function () { return deleteMailTicket(deleteId); });
  }

  // ---- 現場準備台帳 ----
  if (route === "/api/bootstrap" && method === "GET") {
    maybeAutoPollInbox();
    var manifests = readManifests();
    return {
      manifests: manifests,
      summary: buildSummary(manifests),
      shareUrls: shareUrls(),
      statusOptions: statusOptions,
      priorityOptions: priorityOptions,
      requestTypeOptions: requestTypeOptions,
      manifestKindOptions: manifestKindOptions,
      notify: notifyStatus(),
      intake: { items: readIntake(), status: inboxStatus() }
    };
  }
  if (route === "/api/summary" && method === "GET") return buildSummary();
  if (route === "/api/lineworks-text" && method === "GET") return { text: buildLineworksText() };
  if (route === "/api/parse-lineworks" && method === "POST") {
    return { parsed: parseLineworksText(body.text || body.lineworksText || "") };
  }
  if (route === "/api/parse-lineworks-batch" && method === "POST") {
    return { items: parseLineworksBatch(body.text || "") };
  }
  if (route === "/api/manifests/batch" && method === "POST") {
    return withLock(function () {
      var result = addManifestBatch(body.items);
      result.summary = buildSummary();
      return result;
    });
  }
  if (route === "/api/notify-lineworks" && method === "POST") {
    postToLineworks(buildLineworksText());
    return { ok: true, status: notifyStatus() };
  }
  if (route === "/api/notify-status" && method === "GET") return notifyStatus();
  if (route === "/api/intake" && method === "GET") return { items: readIntake(), status: inboxStatus() };
  if (route === "/api/intake/poll" && method === "POST") {
    var pollResult = withLock(function () { return pollInboxOnce(); });
    return { result: pollResult, status: inboxStatus() };
  }
  m = route.match(/^\/api\/intake\/([^/]+)\/register$/);
  if (m && method === "POST") {
    var regId = decodeURIComponent(m[1]);
    return withLock(function () {
      var manifest = registerIntakeItem(regId, body);
      return { manifest: manifest, summary: buildSummary(), status: inboxStatus() };
    });
  }
  m = route.match(/^\/api\/intake\/([^/]+)\/dismiss$/);
  if (m && method === "POST") {
    var disId = decodeURIComponent(m[1]);
    return withLock(function () {
      var dismissed = dismissIntakeItem(disId);
      dismissed.status = inboxStatus();
      return dismissed;
    });
  }
  if (route === "/api/analyze-manifest" && method === "POST") return analyzeManifestDraft(body);
  if (route === "/api/invite.txt" && method === "GET") return { text: buildInviteText() };
  if (route === "/api/manifests.csv" && method === "GET") {
    return { csv: '﻿' + toCsv(readManifests()), filename: 'manifest-requests.csv' };
  }
  if (route === "/api/manifests" && method === "POST") {
    return withLock(function () {
      var manifest = addManifest(body);
      return { manifest: manifest, summary: buildSummary() };
    });
  }
  m = route.match(/^\/api\/manifests\/([^/]+)$/);
  if (m && method === "PATCH") {
    var manifestId = decodeURIComponent(m[1]);
    return withLock(function () {
      var manifest = updateManifest(manifestId, body);
      return { manifest: manifest, summary: buildSummary() };
    });
  }
  if (m && method === "DELETE") {
    var delManifestId = decodeURIComponent(m[1]);
    return withLock(function () { return deleteManifest(delManifestId); });
  }

  var error = new Error("不明なAPIルートです: " + method + " " + route);
  error.statusCode = 404;
  throw error;
}

function withLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ============================== スプレッドシート データ層 ==============================

function dataSpreadsheet() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty("DATA_SPREADSHEET_ID");
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (error) {
      // 削除された場合は作り直す
    }
  }
  var ss = SpreadsheetApp.create(DATA_SPREADSHEET_NAME);
  props.setProperty("DATA_SPREADSHEET_ID", ss.getId());
  return ss;
}

function ensureSheet(name, headers) {
  var ss = dataSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers && headers.length) {
      sheet.getRange(1, 1, sheet.getMaxRows(), headers.length).setNumberFormat("@");
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

function cellToString(value, key) {
  if (value === null || value === undefined) return "";
  if (Object.prototype.toString.call(value) === "[object Date]") {
    if (DATE_ONLY_KEYS[key]) return Utilities.formatDate(value, "Asia/Tokyo", "yyyy-MM-dd");
    return value.toISOString();
  }
  return String(value);
}

function readRecords(sheetName, headers, jsonKeys) {
  var sheet = ensureSheet(sheetName, headers);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var records = [];
  for (var i = 0; i < values.length; i++) {
    var record = {};
    var empty = true;
    for (var j = 0; j < headers.length; j++) {
      var key = headers[j];
      var text = cellToString(values[i][j], key);
      if (text) empty = false;
      if (jsonKeys && jsonKeys[key]) {
        try {
          record[key] = text ? JSON.parse(text) : [];
        } catch (error) {
          record[key] = [];
        }
      } else {
        record[key] = text;
      }
    }
    if (!empty) records.push(record);
  }
  return records;
}

function writeRecords(sheetName, headers, jsonKeys, records) {
  var sheet = ensureSheet(sheetName, headers);
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, headers.length).clearContent();
  }
  if (!records.length) return;
  var values = records.map(function (record) {
    return headers.map(function (key) {
      var value = record[key];
      if (jsonKeys && jsonKeys[key]) return JSON.stringify(value || []);
      if (value === null || value === undefined) return "";
      return String(value);
    });
  });
  sheet.getRange(2, 1, values.length, headers.length).setNumberFormat("@").setValues(values);
}

// ---- 状態(キー/値) ----

function readState() {
  var sheet = ensureSheet(SHEET_STATE, ["key", "value"]);
  var lastRow = sheet.getLastRow();
  var state = {};
  if (lastRow < 2) return state;
  var values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  for (var i = 0; i < values.length; i++) {
    var key = cellToString(values[i][0], "key");
    if (key) state[key] = cellToString(values[i][1], "value");
  }
  return state;
}

function writeStateValues(patch) {
  var sheet = ensureSheet(SHEET_STATE, ["key", "value"]);
  var lastRow = sheet.getLastRow();
  var values = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 2).getValues() : [];
  var index = {};
  for (var i = 0; i < values.length; i++) {
    index[cellToString(values[i][0], "key")] = i;
  }
  Object.keys(patch).forEach(function (key) {
    var value = patch[key] === null || patch[key] === undefined ? "" : String(patch[key]);
    if (index.hasOwnProperty(key)) {
      sheet.getRange(index[key] + 2, 2).setNumberFormat("@").setValue(value);
    } else {
      sheet.appendRow([key, value]);
      sheet.getRange(sheet.getLastRow(), 1, 1, 2).setNumberFormat("@");
    }
  });
}

// ---- 設定(キー/値) ----

function getConfig() {
  var sheet = ensureSheet(SHEET_CONFIG, ["key", "value"]);
  var lastRow = sheet.getLastRow();
  var config = {};
  Object.keys(DEFAULT_CONFIG).forEach(function (key) { config[key] = DEFAULT_CONFIG[key]; });
  if (lastRow >= 2) {
    var values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    for (var i = 0; i < values.length; i++) {
      var key = cellToString(values[i][0], "key");
      if (key) config[key] = cellToString(values[i][1], "value");
    }
  }
  return config;
}

function seedConfigSheet() {
  var sheet = ensureSheet(SHEET_CONFIG, ["key", "value"]);
  if (sheet.getLastRow() >= 2) return;
  var rows = Object.keys(DEFAULT_CONFIG).map(function (key) { return [key, DEFAULT_CONFIG[key]]; });
  sheet.getRange(2, 1, rows.length, 2).setNumberFormat("@").setValues(rows);
}

// ============================== 台帳(マニフェスト) ==============================

function readManifests() {
  return readRecords(SHEET_MANIFESTS, MANIFEST_HEADERS, MANIFEST_JSON_KEYS)
    .map(normalizeManifest)
    .filter(Boolean)
    .sort(compareManifests);
}

function writeManifests(manifests) {
  var sorted = manifests.map(normalizeManifest).filter(Boolean).sort(compareManifests);
  writeRecords(SHEET_MANIFESTS, MANIFEST_HEADERS, MANIFEST_JSON_KEYS, sorted);
  return sorted;
}

function newId(prefix) {
  return prefix + Utilities.getUuid().slice(0, 8);
}

function normalizeManifest(item) {
  if (!item || !String(item.siteName || "").trim()) return null;
  var now = new Date().toISOString();
  var normalized = {
    id: String(item.id || newId("M-")),
    siteName: String(item.siteName || "").trim(),
    siteAddress: String(item.siteAddress || "").trim(),
    contractorName: String(item.contractorName || "").trim(),
    mapStatus: String(item.mapStatus || "未確認").trim(),
    requestSource: String(item.requestSource || "LINEWORKS").trim(),
    requestType: requestTypeOptions.indexOf(item.requestType) >= 0 ? item.requestType : inferRequestType(item),
    startDate: normalizeDate(item.startDate),
    neededDate: normalizeDate(item.neededDate),
    copies: Math.max(1, parseInt(item.copies, 10) || 1),
    manifestKind: manifestKindOptions.indexOf(item.manifestKind) >= 0 ? item.manifestKind : "紙マニフェスト",
    manifestBreakdown: String(item.manifestBreakdown || "").trim(),
    sourceRoom: String(item.sourceRoom || "LCC現場地図").trim(),
    generator: String(item.generator || "").trim(),
    transporter: String(item.transporter || "").trim(),
    destination: String(item.destination || "").trim(),
    wasteNumber: String(item.wasteNumber || "").trim(),
    wasteTypes: String(item.wasteTypes || "").trim(),
    quantity: String(item.quantity || "").trim(),
    unit: String(item.unit || "㎥").trim(),
    status: statusOptions.indexOf(item.status) >= 0 ? item.status : "未作成",
    priority: priorityOptions.indexOf(item.priority) >= 0 ? item.priority : "中",
    owner: String(item.owner || "").trim(),
    requestedBy: String(item.requestedBy || "").trim(),
    lineworksText: String(item.lineworksText || "").trim(),
    notes: String(item.notes || "").trim(),
    createdAt: item.createdAt || now,
    updatedAt: item.updatedAt || now,
    completedAt: item.completedAt || "",
    handedOffAt: item.handedOffAt || "",
    missingFields: [],
    history: Array.isArray(item.history) ? item.history : []
  };
  normalized.missingFields = missingManifestFields(normalized);
  return normalized;
}

function missingManifestFields(item) {
  var checks = item.requestType === "道具・備品" ? [
    ["siteName", "現場名"],
    ["neededDate", "必要日"],
    ["manifestBreakdown", "準備する道具・備品"]
  ] : [
    ["siteName", "現場名"],
    ["neededDate", "必要日"],
    ["copies", "部数"],
    ["manifestKind", "種類"],
    ["manifestBreakdown", "内訳"],
    ["wasteTypes", "廃棄物の種類"],
    ["destination", "運搬先"],
    ["generator", "排出事業者"]
  ];
  return checks
    .filter(function (check) { return !String(item[check[0]] || "").trim(); })
    .map(function (check) { return check[1]; });
}

function inferRequestType(item) {
  var text = [item.requestType, item.manifestKind, item.manifestBreakdown, item.notes, item.lineworksText].join(" ");
  if (/道具|備品|トンパック|[tｔT]パック|チェ(?:ー)?ンソー|セーバー|アドブル|刃/.test(text)
    && !/マニ|マニフェスト|パーク/.test(text)) {
    return "道具・備品";
  }
  return "マニフェスト";
}

function normalizeDate(value) {
  var text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function parseLineworksText(text) {
  var normalized = String(text || "").replace(/\r/g, "").replace(/[：]/g, ":");
  var result = {};
  result.contractorName = firstMatch(normalized, /元請名\s*:\s*([^\n]+)/) || "";
  result.siteName = firstMatch(normalized, /現場名\s*:\s*([^\n]+)/) || "";
  result.notes = firstMatch(normalized, /備考\s*:\s*([^\n]+)/) || "";

  var startRaw = firstMatch(normalized, /(?:着工|開始)\s*:\s*([0-9０-９]{1,2}[\/月][0-9０-９]{1,2})/)
    || firstMatch(normalized, /([0-9０-９]{1,2}[\/月][0-9０-９]{1,2})\s*(?:着工|開始)/);
  var neededRaw = firstMatch(normalized, /(?:必要日|準備|期限)\s*:\s*([0-9０-９]{1,2}[\/月][0-9０-９]{1,2})/)
    || firstMatch(normalized, /([0-9０-９]{1,2}[\/月][0-9０-９]{1,2})\s*まで/)
    || firstMatch(normalized, /(?:必要日|準備|期限)\s*:\s*(今日|明日|明後日)/)
    || firstMatch(normalized, /(今日|明日|明後日)\s*(?:まで|中|朝|午前|夕方)?/);
  result.startDate = startRaw ? toDateInput(startRaw) : "";
  result.neededDate = neededRaw ? toDateInput(neededRaw) : "";

  if (/マニフェスト・備品発注/.test(normalized)) result.sourceRoom = "マニフェスト・備品発注";
  if (/現場地図|元請名|現場名|着工/.test(normalized)) result.sourceRoom = "LCC現場地図";

  var manifestPhrases = extractManifestPhrases(normalized);
  var supplyPhrases = extractSupplyPhrases(normalized);
  result.requestType = manifestPhrases.length ? "マニフェスト" : supplyPhrases.length ? "道具・備品" : "マニフェスト";
  if (!manifestPhrases.length && /マニフェスト/.test(normalized)) {
    manifestPhrases.push(firstMatch(normalized, /(マニフェスト[^。\n]*)/) || "マニフェスト");
  }
  result.manifestBreakdown = result.requestType === "道具・備品"
    ? uniqueList(supplyPhrases).join("、")
    : uniqueList(manifestPhrases).join("、");
  result.copies = result.requestType === "道具・備品"
    ? sumSupplyQuantities(result.manifestBreakdown) || 1
    : sumCopies(result.manifestBreakdown) || "";
  result.destination = inferDestination(result.manifestBreakdown || normalized);
  result.manifestKind = result.requestType === "道具・備品"
    ? "道具・備品"
    : /電子/.test(normalized) ? "電子マニフェスト" : /追加/.test(normalized) ? "追加マニフェスト" : "紙マニフェスト";
  if (supplyPhrases.length && result.requestType !== "道具・備品") {
    result.notes = [result.notes, "備品: " + supplyPhrases.join("、")].filter(Boolean).join(" / ");
  }
  if (!result.siteName) {
    var candidate = guessSiteName(normalized, manifestPhrases.concat(supplyPhrases));
    if (candidate) {
      result.siteName = candidate;
      result.siteNameAssumed = true;
    }
  }
  if (!result.neededDate && result.startDate) {
    result.neededDate = addDays(result.startDate, -1);
    result.neededDateAssumed = true;
  }
  result.lineworksText = normalized.trim();
  return result;
}

function uniqueList(list) {
  var seen = {};
  var out = [];
  for (var i = 0; i < list.length; i++) {
    if (!seen[list[i]]) {
      seen[list[i]] = true;
      out.push(list[i]);
    }
  }
  return out;
}

// 「淞北台山建プラント用（玉湯）マニ6枚…お願いします」のような1行依頼から、
// マニ内訳・備品・挨拶を取り除いた残りを現場名の候補として推定する。
// 挨拶・締め・報告の定型文。現場名の候補から必ず除外する。
var greetingLikePattern = /^(?:お疲れ様|お疲れさま|おつかれさま|ご苦労様|お世話にな|いつもお世話|よろしくお願い|宜しくお願い|おはよう|こんにちは|こんばんは|ありがとうござ|失礼(?:します|いたします)|了解|承知|かしこまり)/;

// 行頭の挨拶(「お疲れ様です。岩崎邸の…」など)を取り除く。
function stripGreetingPrefix(line) {
  return String(line || "")
    .replace(/^(?:お疲れ様です|お疲れさまです|おつかれさまです|ご苦労様です|お世話になります|お世話になっております|いつもお世話になっております|おはようございます|こんにちは|こんばんは)[。．、!！\s]*/, "")
    .trim();
}

function guessSiteName(text, phrases) {
  var lines = text.split("\n").map(function (line) { return line.trim(); }).filter(Boolean);
  var firstLine = "";
  for (var j = 0; j < lines.length; j++) {
    var line = stripGreetingPrefix(lines[j]);
    if (!line || greetingLikePattern.test(line)) continue;
    firstLine = line;
    break;
  }
  var candidate = firstLine;
  for (var i = 0; i < phrases.length; i++) {
    candidate = candidate.split(phrases[i]).join("");
  }
  candidate = candidate
    .replace(/を?お願い(?:します|致します|いたします)?[。．!！\s]*$/g, "")
    .replace(/(?:普通)?マニ(?:フェスト)?[はが]?[^、。\n]*$/g, "")
    .replace(/[、。，,\s]+$/g, "")
    .replace(/の$/, "")
    .trim();
  if (candidate.length < 2 || candidate.length > 25) return "";
  if (/^(マニ|パーク|トンパック|[tｔT]パック|チェ|セ[ーイ]バー|アドブル)/.test(candidate)) return "";
  if (greetingLikePattern.test(candidate)) return "";
  if (/(?:します|しました|ました|きました|ります|です|ます|でしょうか|ですか|ますか|ください|下さい)[。．!！?？]*$/.test(candidate)) return "";
  return candidate;
}

var requestKeywordPattern = /マニ|パーク|トンパック|[tｔT]パック|チェ(?:ー)?ンソー|セ[ーイ]バー|アドブル|ブルーシート|土のう|土嚢|カラーコーン|コーン|バリケード|養生テープ|ガムテープ|軍手|手袋|ヘルメット|安全帯|インパクト|丸ノコ|丸のこ|サンダー|脚立|延長コード|発電機|投光器/;

// LINEWORKSのトーク画面をまとめてコピーしたログを、依頼1件ずつのブロックに分解する。
function splitLineworksLog(text) {
  var lines = String(text || "").replace(/\r/g, "").replace(/[：]/g, ":").split("\n");
  var blocks = [];
  var current = null;
  var pendingName = "";

  var isNoiseLine = function (line) {
    return !line
      || /^\d{1,2}:\d{2}$/.test(line)
      || /^\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.?\s*(?:\([月火水木金土日]\))?$/.test(line)
      || /^既読(?:\s*\d+)?$/.test(line)
      || /^未読トーク$/.test(line)
      || /^(?:位置情報|\(写真\)|\(動画\)|\(ファイル\)|写真\/動画)$/.test(line)
      || /^日本、〒/.test(line)
      || /^https?:\/\//.test(line)
      || /さんがトークの送信を取り消しました。?$/.test(line)
      || /さんがグループトークルームに参加しました。?$/.test(line)
      || /提出(?:BOX|ＢＯＸ|ボックス)|マニフェスト(?:依頼)?ボックス|デスク(?:の)?上に置|入れておきます|入っております|置いてあります/.test(line);
  };

  var siteLikePattern = /邸|様|建屋|工事|現場|作業所|物件|倉庫|小屋|ビル|マンション|アパート|解体|改修|撤去|植栽|台/;
  var isNameLine = function (line) {
    return line.length >= 2 && line.length <= 12
      && !requestKeywordPattern.test(line)
      && !greetingLikePattern.test(line)
      && !siteLikePattern.test(line)
      && !/[0-9０-９]/.test(line)
      && !/[:。、,，]/.test(line)
      && !/お願い/.test(line);
  };

  var flush = function () {
    if (current && current.lines.length) {
      blocks.push({ requestedBy: current.requestedBy, text: current.lines.join("\n") });
    }
    current = null;
  };

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (isNoiseLine(line)) continue;
    if (/^元請名\s*:/.test(line)) {
      flush();
      current = { requestedBy: pendingName, lines: [line] };
      continue;
    }
    if (current && /^(?:現場名|着工|開始|備考|必要日|期限)\s*:/.test(line)) {
      current.lines.push(line);
      continue;
    }
    if (isNameLine(line)) {
      flush();
      pendingName = line;
      continue;
    }
    if (requestKeywordPattern.test(line) && current && /お願い/.test(current.lines[current.lines.length - 1] || "")) {
      flush();
    }
    if (current) {
      current.lines.push(line);
    } else {
      current = { requestedBy: pendingName, lines: [line] };
    }
  }
  flush();
  return blocks.filter(function (block) {
    return requestKeywordPattern.test(block.text) || /元請名|現場名/.test(block.text);
  });
}

function parseLineworksBatch(text) {
  var manifests = readManifests();
  return splitLineworksLog(text).map(function (block) {
    var parsed = parseLineworksText(block.text);
    parsed.requestedBy = block.requestedBy || "";
    var analysis = analyzeManifestDraft(mergeObjects(parsed, { status: "未作成" }), manifests);
    return mergeObjects(parsed, { warnings: analysis.warnings, duplicateCandidates: analysis.duplicateCandidates });
  });
}

function mergeObjects(base, extra) {
  var out = {};
  Object.keys(base).forEach(function (key) { out[key] = base[key]; });
  Object.keys(extra).forEach(function (key) { out[key] = extra[key]; });
  return out;
}

function addManifestBatch(items) {
  var manifests = readManifests();
  var now = new Date().toISOString();
  var added = [];
  var errors = [];
  var list = Array.isArray(items) ? items : [];
  for (var i = 0; i < list.length; i++) {
    var item = list[i];
    var manifest = normalizeManifest(mergeObjects(item, {
      id: newId("M-"),
      status: "未作成",
      createdAt: now,
      updatedAt: now,
      history: [{ at: now, by: String(item.by || item.owner || "まとめ取込"), summary: "登録(まとめ取込)" }]
    }));
    if (!manifest) {
      errors.push("現場名がない依頼はスキップしました: " + String(item.lineworksText || "").slice(0, 30));
      continue;
    }
    if (!manifest.neededDate) {
      errors.push("必要日がない依頼はスキップしました: " + manifest.siteName);
      continue;
    }
    manifests.push(manifest);
    added.push(manifest.id);
  }
  if (added.length) writeManifests(manifests);
  return { added: added.length, skipped: errors.length, errors: errors };
}

// マニフェスト以外の備品依頼(トンパック・刃物・アドブル等)を拾ってメモへ回す
function extractSupplyPhrases(text) {
  var patterns = [
    /トンパック\s*[0-9０-９]+\s*(?:枚|袋|個|つ|体)/g,
    /[tｔT]パック\s*[0-9０-９]+\s*(?:枚|袋|個|つ|体)/g,
    /チェ(?:ー)?ンソーの刃(?:\s*を?\s*[0-9０-９一二三]*\s*(?:枚|個|つ|セット)?)?/g,
    /セ[ーイ]バー(?:ソー)?の刃(?:\s*[0-9０-９一二三]*\s*(?:枚|個|つ|セット)?)?/g,
    /アドブル液?\s*[0-9０-９一二三]*\s*(?:つ|個|本)?/g,
    /(?:ブルーシート|土のう袋|土嚢袋|カラーコーン|コーン|バリケード|養生テープ|ガムテープ|軍手|手袋|マスク|ヘルメット|安全帯|インパクト|丸ノコ|丸のこ|サンダー|脚立|延長コード|発電機|投光器)\s*[0-9０-９一二三四五六七八九十]*\s*(?:枚|袋|個|つ|体|本|セット|台|箱|束)?/g
  ];
  return maskedExtract(text, patterns, function (matchText) {
    return matchText.replace(/を\s*$/, "").trim();
  });
}

function extractManifestPhrases(text) {
  // 同じ「マニ6枚」が複数パターンに重複マッチして部数が二重計上されないよう、
  // 具体的なパターンから順にマッチさせ、マッチ済みの範囲は伏せ字にして除外する。
  var patterns = [
    /山建プラント用(?:（[^）]+）)?\s*マニ(?:フェスト)?\s*[0-9０-９]+\s*(?:枚|部)/g,
    /前田マニ(?:フェスト)?\s*[0-9０-９]+\s*(?:枚|部)/g,
    /普通マニ(?:フェスト)?\s*[はが]?\s*[0-9０-９]+\s*(?:枚|部)/g,
    /パーク(?:マニ(?:フェスト)?)?\s*[0-9０-９]+\s*(?:枚|部)/g,
    /マニ(?:フェスト)?\s*[はが]?\s*[^、。\n]*?[0-9０-９]+\s*(?:枚|部)/g
  ];
  return maskedExtract(text, patterns, function (matchText) { return matchText.trim(); });
}

function maskedExtract(text, patterns, cleanup) {
  var masked = text;
  var found = [];
  for (var p = 0; p < patterns.length; p++) {
    var pattern = patterns[p];
    pattern.lastIndex = 0;
    var match;
    while ((match = pattern.exec(masked)) !== null) {
      found.push({ index: match.index, phrase: cleanup(match[0]) });
      masked = masked.slice(0, match.index)
        + repeatChar("＊", match[0].length)
        + masked.slice(match.index + match[0].length);
      pattern.lastIndex = match.index + match[0].length;
    }
  }
  return found.sort(function (a, b) { return a.index - b.index; }).map(function (item) { return item.phrase; });
}

function repeatChar(char, count) {
  return new Array(count + 1).join(char);
}

function analyzeManifestDraft(body, manifests) {
  if (!manifests) manifests = readManifests();
  var draft = normalizeManifest(mergeObjects(body, { siteName: body.siteName || "入力中" }));
  var warnings = [];
  var required = draft.requestType === "道具・備品" ? [
    ["siteName", "現場名"],
    ["neededDate", "必要日"],
    ["manifestBreakdown", "準備する道具・備品"]
  ] : [
    ["siteName", "現場名"],
    ["neededDate", "必要日"],
    ["copies", "部数"],
    ["manifestBreakdown", "マニフェスト内訳"],
    ["destination", "運搬先"],
    ["wasteTypes", "廃棄物の種類"],
    ["generator", "排出事業者"]
  ];

  for (var i = 0; i < required.length; i++) {
    if (!String(body[required[i][0]] || "").trim()) warnings.push(required[i][1] + "が未入力です。");
  }
  if (draft.neededDate && draft.startDate && draft.neededDate > draft.startDate) {
    warnings.push("必要日が着工日より後になっています。日付を確認してください。");
  }
  if (draft.neededDate && draft.neededDate < todayJst() && ["受渡済み", "不要/保留"].indexOf(draft.status) === -1) {
    warnings.push("必要日が過ぎています。状態または日付を確認してください。");
  }

  var siteKey = normalizeSearchKey(body.siteName);
  var duplicateCandidates = siteKey
    ? manifests
      .filter(function (item) {
        return normalizeSearchKey(item.siteName) === siteKey
          || normalizeSearchKey(item.lineworksText).indexOf(siteKey) >= 0;
      })
      .filter(function (item) { return !body.id || item.id !== body.id; })
      .filter(function (item) {
        return !draft.neededDate || item.neededDate === draft.neededDate || item.startDate === draft.startDate;
      })
      .slice(0, 5)
      .map(function (item) {
        return {
          id: item.id,
          requestType: item.requestType,
          siteName: item.siteName,
          neededDate: item.neededDate,
          startDate: item.startDate,
          status: item.status,
          owner: item.owner
        };
      })
    : [];

  if (duplicateCandidates.length) {
    warnings.push("同じ現場名・近い日付の依頼が既にあります。二重登録でないか確認してください。");
  }

  return {
    ok: warnings.length === 0,
    warnings: uniqueList(warnings),
    duplicateCandidates: duplicateCandidates
  };
}

function normalizeSearchKey(value) {
  return toHalfWidth(value)
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[　、。，．・･:：/／\\\-ー_＿]/g, "");
}

function firstMatch(text, pattern) {
  var match = text.match(pattern);
  return match ? match[1].trim() : "";
}

function toDateInput(value) {
  var relative = relativeDateInput(value);
  if (relative) return relative;
  var match = String(value || "").match(/([0-9０-９]{1,2})[\/月]([0-9０-９]{1,2})/);
  if (!match) return "";
  var today = todayJst();
  var year = Number(today.slice(0, 4));
  var month = padStart2(toHalfWidth(match[1]));
  var day = padStart2(toHalfWidth(match[2]));
  var candidate = year + "-" + month + "-" + day;
  // 12月に「1/15着工」のような年をまたぐ依頼は翌年の日付とみなす
  if (candidate < addDays(today, -30)) return (year + 1) + "-" + month + "-" + day;
  return candidate;
}

function padStart2(text) {
  return String(text).length >= 2 ? String(text) : "0" + text;
}

function relativeDateInput(value) {
  var text = String(value || "").trim();
  if (text === "今日") return todayJst();
  if (text === "明日") return addDays(todayJst(), 1);
  if (text === "明後日") return addDays(todayJst(), 2);
  return "";
}

function sumCopies(text) {
  var total = 0;
  var pattern = /([0-9０-９]+)\s*(?:枚|部)/g;
  var match;
  var source = String(text || "");
  while ((match = pattern.exec(source)) !== null) {
    total += Number(toHalfWidth(match[1])) || 0;
  }
  return total;
}

function sumSupplyQuantities(text) {
  var total = 0;
  var pattern = /([0-9０-９一二三四五六七八九十]+)\s*(?:枚|袋|個|つ|体|本|セット|台|箱|束)/g;
  var match;
  var source = String(text || "");
  while ((match = pattern.exec(source)) !== null) {
    total += japaneseNumber(match[1]) || 0;
  }
  return total;
}

function japaneseNumber(value) {
  var text = toHalfWidth(value);
  if (/^\d+$/.test(text)) return Number(text);
  var map = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10 };
  if (text === "十") return 10;
  var tenIndex = text.indexOf("十");
  if (tenIndex >= 0) {
    var before = text.slice(0, tenIndex);
    var after = text.slice(tenIndex + 1);
    return (before ? map[before] || 0 : 1) * 10 + (after ? map[after] || 0 : 0);
  }
  return map[text] || 0;
}

function toHalfWidth(value) {
  return String(value).replace(/[０-９]/g, function (char) {
    return String.fromCharCode(char.charCodeAt(0) - 0xfee0);
  });
}

function inferDestination(text) {
  if (/パーク|クリーンパーク/.test(text)) return "クリーンパーク";
  if (/山建/.test(text)) return "山建プラント";
  if (/前田マニ/.test(text)) return "前田";
  if (/アース/.test(text)) return "アース";
  if (/出雲土建/.test(text)) return "出雲土建";
  return "";
}

function compareManifests(a, b) {
  var statusWeight = { "未作成": 0, "作成中": 1, "作成済み": 2, "受渡済み": 8, "不要/保留": 9 };
  var priorityWeight = { "高": 0, "中": 1, "低": 2 };
  return (valueOr(statusWeight[a.status], 5)) - (valueOr(statusWeight[b.status], 5))
    || dateValue(a.neededDate) - dateValue(b.neededDate)
    || dateValue(a.startDate) - dateValue(b.startDate)
    || (valueOr(priorityWeight[a.priority], 9)) - (valueOr(priorityWeight[b.priority], 9))
    || String(a.siteName).localeCompare(String(b.siteName), "ja");
}

function valueOr(value, fallback) {
  return value === undefined || value === null ? fallback : value;
}

function dateValue(value) {
  return value ? new Date(value + "T00:00:00+09:00").getTime() : 9007199254740991;
}

function addManifest(body) {
  var now = new Date().toISOString();
  var manifest = normalizeManifest(mergeObjects(body, {
    id: newId("M-"),
    createdAt: now,
    updatedAt: now,
    history: [{ at: now, by: String(body.by || body.owner || "未指定"), summary: "登録" }]
  }));
  if (!manifest) throw new Error("現場名は必須です。");
  if (!manifest.neededDate) throw new Error("必要日は必須です。");
  var manifests = readManifests();
  manifests.push(manifest);
  var saved = writeManifests(manifests);
  return findById(saved, manifest.id);
}

function findById(list, id) {
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) return list[i];
  }
  return null;
}

function updateManifest(id, body) {
  var manifests = readManifests();
  var index = -1;
  for (var i = 0; i < manifests.length; i++) {
    if (manifests[i].id === id) { index = i; break; }
  }
  if (index === -1) {
    var notFound = new Error("対象の依頼が見つかりません。");
    notFound.statusCode = 404;
    throw notFound;
  }
  var before = manifests[index];
  var now = new Date().toISOString();
  var next = normalizeManifest(mergeObjects(mergeObjects(before, body), {
    id: before.id,
    createdAt: before.createdAt,
    updatedAt: now,
    completedAt: body.status === "作成済み" && before.status !== "作成済み" ? now : before.completedAt,
    handedOffAt: body.status === "受渡済み" && before.status !== "受渡済み" ? now : before.handedOffAt
  }));
  if (!next) {
    var badRequest = new Error("現場名は空にできません。");
    badRequest.statusCode = 400;
    throw badRequest;
  }
  next.history = [{
    at: now,
    by: String(body.by || body.owner || "未指定"),
    summary: summarizeChanges(before, next)
  }].concat(before.history || []).slice(0, 30);
  manifests[index] = next;
  var saved = writeManifests(manifests);
  return findById(saved, id);
}

function deleteManifest(id) {
  var manifests = readManifests();
  var next = manifests.filter(function (item) { return item.id !== id; });
  if (next.length === manifests.length) {
    var notFound = new Error("対象の依頼が見つかりません。");
    notFound.statusCode = 404;
    throw notFound;
  }
  writeManifests(next);
  return { ok: true };
}

function summarizeChanges(before, after) {
  var labels = {
    siteName: "現場名",
    siteAddress: "現場住所",
    contractorName: "請求先/元請",
    requestType: "依頼種別",
    neededDate: "必要日",
    startDate: "着工日",
    copies: "部数",
    manifestKind: "種類",
    manifestBreakdown: "内訳",
    wasteTypes: "廃棄物",
    destination: "運搬先",
    status: "状態",
    owner: "担当",
    mapStatus: "地図",
    priority: "優先度"
  };
  var changes = Object.keys(labels)
    .filter(function (key) { return String(before[key] || "") !== String(after[key] || ""); })
    .map(function (key) { return labels[key] + ": " + (before[key] || "-") + " -> " + (after[key] || "-"); });
  return changes.length ? changes.join(" / ") : "内容更新";
}

function buildSummary(manifests) {
  if (!manifests) manifests = readManifests();
  var today = todayJst();
  var tomorrow = addDays(today, 1);
  var active = manifests.filter(function (item) { return ["受渡済み", "不要/保留"].indexOf(item.status) === -1; });
  var overdue = active.filter(function (item) { return item.neededDate && item.neededDate < today; });
  var dueToday = active.filter(function (item) { return item.neededDate === today; });
  var dueTomorrow = active.filter(function (item) { return item.neededDate === tomorrow; });
  var unmade = active.filter(function (item) { return ["未作成", "作成中"].indexOf(item.status) >= 0; });
  var incomplete = active.filter(function (item) { return (item.missingFields || []).length > 0; });
  var supplyActive = active.filter(function (item) { return item.requestType === "道具・備品"; });
  var manifestActive = active.filter(function (item) { return item.requestType !== "道具・備品"; });
  return {
    today: today,
    totalActive: active.length,
    totalCopies: active.reduce(function (sum, item) { return sum + item.copies; }, 0),
    manifestActive: manifestActive.length,
    supplyActive: supplyActive.length,
    unmade: unmade.length,
    incomplete: incomplete.length,
    overdue: overdue.length,
    dueToday: dueToday.length,
    dueTomorrow: dueTomorrow.length,
    ready: manifests.filter(function (item) { return item.status === "作成済み"; }).length,
    handoffDone: manifests.filter(function (item) { return item.status === "受渡済み"; }).length,
    nextItems: active.sort(compareManifests).slice(0, 8),
    checklist: buildChecklist(manifests)
  };
}

function buildChecklist(manifests) {
  if (!manifests) manifests = readManifests();
  var today = todayJst();
  return manifests
    .filter(function (item) { return ["受渡済み", "不要/保留"].indexOf(item.status) === -1; })
    .filter(function (item) { return !item.neededDate || item.neededDate <= addDays(today, 3); })
    .sort(compareManifests)
    .map(function (item) {
      var marker = !item.neededDate ? "日付未定"
        : item.neededDate < today ? "期限超過"
          : item.neededDate === today ? "本日必要"
            : item.neededDate === addDays(today, 1) ? "明日必要"
              : "確認";
      var missing = (item.missingFields || []).length ? " / 未入力: " + item.missingFields.join("・") : "";
      var detail = requestDetail(item);
      return marker + ": " + (item.neededDate || "日付未定") + " [" + item.requestType + "] " + item.siteName + " " + detail + " (" + item.status + ")" + missing;
    });
}

function requestDetail(item) {
  if (item.manifestBreakdown) return item.manifestBreakdown;
  if (item.requestType === "道具・備品") return "準備品 " + item.copies + "点";
  return item.manifestKind + " " + item.copies + "部";
}

function todayJst() {
  return Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd");
}

function addDays(yyyyMmDd, days) {
  var match = String(yyyyMmDd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return yyyyMmDd;
  var date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return date.toISOString().slice(0, 10);
}

/** "2026-08-19" を "8/19(水)" に整形する。現場は曜日で動くため通知の見出しに使う。 */
function formatJpDate(yyyyMmDd) {
  var match = String(yyyyMmDd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(yyyyMmDd || "");
  var date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  var youbi = ["日", "月", "火", "水", "木", "金", "土"][date.getUTCDay()];
  return Number(match[2]) + "/" + Number(match[3]) + "(" + youbi + ")";
}

function buildLineworksText() {
  var summary = buildSummary();
  // 0件の項目は出さない(1件しかない日に同じ1件を何度も数えて見せないため)
  var counts = [];
  if (summary.unmade) counts.push("未作成/作成中: " + summary.unmade + "件");
  if (summary.overdue) counts.push("期限超過: " + summary.overdue + "件");
  if (summary.dueToday) counts.push("本日必要: " + summary.dueToday + "件");
  if (summary.supplyActive) counts.push("道具・備品: " + summary.supplyActive + "件");

  var lines = ["準備確認 " + formatJpDate(summary.today)];
  // 明細が3件以上ある日だけ件数行を出す。1〜2件の日は明細に全部書いてあるので、
  // 件数行は同じ1件を「未作成1件・本日必要1件・道具備品1件」と3回数えて見せるだけになる。
  if (counts.length && summary.checklist.length >= 3) lines.push(counts.join("、"));
  lines.push("");
  lines = lines.concat(summary.checklist.slice(0, 12));
  if (!summary.checklist.length) lines.push("直近3日以内の未完了依頼はありません。");
  // 現場向けの通知なので、現場が動かせる「受信箱の未登録依頼」だけ知らせる。
  // メール未対応の件数は事務の指標なので、社長宛の朝ブリーフィング(MorningBrief.gs)側に集約した。
  try {
    var intakePending = readIntake().filter(function (item) {
      return ((item.parsed || {}).intakeKind || "request") !== "chat";
    }).length;
    if (intakePending) lines.push("", "受信箱の未登録依頼: " + intakePending + "件");
  } catch (error) {
    // 集計に失敗しても通知自体は送る
  }
  return lines.join("\n") + "\n";
}

function buildInviteText() {
  return [
    "マニフェスト・道具・備品依頼は、LINEWORKS投稿後にこの台帳へ転記してください。",
    "",
    "最低限入力するもの:",
    "- 現場名",
    "- 必要日",
    "- 必要部数",
    "- 道具・備品名と数量",
    "- 着工日",
    "- 地図の共有状況",
    "",
    "共有URL:"
  ].concat(shareUrls()).join("\n");
}

// ============================== LINEWORKS通知 ==============================

function lineworksWebhookUrl() {
  return String(getConfig().LINEWORKS_WEBHOOK_URL || "").trim();
}

function postToLineworks(text) {
  var url = lineworksWebhookUrl();
  if (!url) throw new Error("LINEWORKS_WEBHOOK_URLが未設定です。設定シートに通知先WebhookのURLを設定してください。");
  var format = String(getConfig().LINEWORKS_WEBHOOK_FORMAT || "").toLowerCase();
  // 既定はLINE WORKS公式「Incoming Webhookアプリ」の形式 {title, body:{text}, button}
  var ledgerUrl = webAppUrl();
  var payload = format === "simple" ? { text: text }
    : format === "content" ? { content: { type: "text", text: text } }
      : mergeObjects(
        { title: "現場準備台帳", body: { text: text } },
        ledgerUrl ? { button: { label: "台帳を開く", url: ledgerUrl } } : {}
      );
  var response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error("LINEWORKSへの送信に失敗しました (HTTP " + code + ") " + response.getContentText().slice(0, 120));
  }
  writeStateValues({ notifyLastSentAt: new Date().toISOString() });
  return { ok: true };
}

function notifyStatus() {
  var state = readState();
  return {
    configured: Boolean(lineworksWebhookUrl()),
    autoTime: hasMorningTrigger() ? "07:30" : "",
    lastSentAt: state.notifyLastSentAt || "",
    lastAutoDate: state.notifyLastAutoDate || ""
  };
}

function hasMorningTrigger() {
  return ScriptApp.getProjectTriggers().some(function (trigger) {
    return trigger.getHandlerFunction() === "sendMorningNotify";
  });
}

/** テスト用: 通知は送らず、朝の通知本文だけを実行ログに出す */
function previewMorningNotify() {
  Logger.log(buildLineworksText());
}

/** 毎朝の自動通知本体(時間主導トリガーから呼ばれる)。PCスリープ問題の根本解決。 */
function sendMorningNotify() {
  if(isCompanyClosed_(new Date())){ Logger.log("会社休日のため朝通知をスキップ"); return; }
  var today = todayJst();
  var state = readState();
  if (state.notifyLastAutoDate === today) return; // 二重送信防止
  // 送信より先にフラグを立てると、送信が失敗した日の通知が黙って消える。必ず送信成功後に記録する。
  postToLineworks(buildLineworksText());
  writeStateValues({ notifyLastAutoDate: today });
}

/**
 * 【最終切替時のみ実行】毎朝7:30前後にLINEWORKS通知する時間主導トリガーを作る。
 * PC版の自動通知が生きている間に実行すると通知が二重になるので注意。
 */
function enableMorningNotify() {
  disableMorningNotify();
  ScriptApp.newTrigger("sendMorningNotify")
    .timeBased()
    .everyDays(1)
    .atHour(7)
    .nearMinute(30)
    .create();
}

function disableMorningNotify() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === "sendMorningNotify") {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

/** (任意) 5分ごとにLINEWORKS受信箱を取り込むトリガー。画面を開けば自動取込されるため必須ではない。 */
function enableAutoPolling() {
  disableAutoPolling();
  ScriptApp.newTrigger("autoPollTick").timeBased().everyMinutes(5).create();
}

function disableAutoPolling() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === "autoPollTick") {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function autoPollTick() {
  try {
    withLock(function () { return pollInboxOnce(); });
  } catch (error) {
    // 次回に任せる
  }
  maybeAutoImportGmail();
}

// ============================== 受信箱(LINEWORKS取込) ==============================

/**
 * 受信箱に入った投稿が「依頼」か「雑談・連絡(報告・挨拶など)」かを判定する。
 * 安全側: 迷ったら「依頼」として扱う(本物の依頼を雑談扱いして見落とさないため)。
 * 雑談判定でも受信箱から消さず、画面では折り畳み表示になるだけ。
 */
function classifyIntakeKind(text) {
  var t = String(text || "");
  // 定型フォーマット(元請名:/現場名:)は必ず依頼
  if (/(?:元請名|現場名)\s*[:：]/.test(t)) return "request";
  // 締めの挨拶「よろしくお願いします」は依頼の言い回しに数えない
  var stripped = t.replace(/(?:よろしく|宜しく)お願い(?:します|いたします|致します|申し上げます)?/g, "");
  // 依頼らしい言い回しがあれば依頼
  var requestish = /お願い|下さい|ください|くれ(?:ます)?か|頂け|いただけ|もらえ|欲しい|ほしい|必要|至急|依頼|手配|発注し(?:て|といて)|注文し(?:て|といて)|準備し(?:て|といて)|用意し(?:て|といて)|作成し(?:て|といて)|作っ(?:て|といて)|持ってき|届けて|ありますか|あるか|何枚|いくつ|ますか|ませんか|でしょうか/;
  if (requestish.test(stripped)) return "request";
  // 報告・完了連絡・挨拶・受け答えだけなら雑談・連絡
  var chatish = /完了(?:しました|です|いたしました)|済み(?:です)?|済んで|しておきました|しときました|置いておきました|置いときました|作りました|作成しました|発注しました|発注済み|注文しました|購入しました|買いました|届きました|受け取りました|受領|渡しました|お渡ししました|納品|もらいました|頂きました|いただきました|ありがとうござ|お疲れ様|お疲れさま|おつかれさま|ご苦労様|了解|承知|かしこまりました|大丈夫です|助かります/;
  if (chatish.test(t)) return "chat";
  return "request";
}

/**
 * 修正後のパーサーを受信箱の既存カードに再適用する(手動実行用)。
 * 元の文面(text)は変更せず、parsed/warningsだけ作り直す。
 */
function reparseIntakeCards() {
  var intake = readIntake();
  var manifests = readManifests();
  var changed = 0;
  for (var i = 0; i < intake.length; i++) {
    var item = intake[i];
    var oldParsed = item.parsed || {};
    var parsed = parseLineworksText(item.text);
    parsed.requestedBy = String(oldParsed.requestedBy || item.sender || "").trim();
    parsed.intakeKind = oldParsed.intakeKind || classifyIntakeKind(item.text);
    var analysis = analyzeManifestDraft(mergeObjects(parsed, { status: "未作成" }), manifests);
    if (JSON.stringify(parsed) !== JSON.stringify(oldParsed)) changed++;
    item.parsed = parsed;
    item.warnings = analysis.warnings;
    item.duplicateCandidates = analysis.duplicateCandidates;
  }
  writeIntake(intake);
  Logger.log("再パース: 更新 " + changed + " 件 / 全 " + intake.length + " 件");
  return changed;
}

function readIntake() {
  return readRecords(SHEET_INTAKE, INTAKE_HEADERS, INTAKE_JSON_KEYS).map(function (item) {
    var parsed = Array.isArray(item.parsed) ? {} : item.parsed || {};
    if (!parsed.intakeKind) parsed.intakeKind = classifyIntakeKind(item.text);
    return {
      id: item.id,
      receivedAt: item.receivedAt,
      postedAt: item.postedAt,
      room: item.room,
      sender: item.sender,
      text: item.text,
      parsed: parsed,
      warnings: item.warnings || [],
      duplicateCandidates: item.duplicateCandidates || []
    };
  });
}

function writeIntake(items) {
  writeRecords(SHEET_INTAKE, INTAKE_HEADERS, INTAKE_JSON_KEYS, items);
}

function readProcessedIds() {
  var state = readState();
  try {
    var ids = JSON.parse(state.processedIds || "[]");
    return Array.isArray(ids) ? ids : [];
  } catch (error) {
    return [];
  }
}

function writeProcessedIds(ids) {
  writeStateValues({ processedIds: JSON.stringify(ids.slice(-2000)) });
}

function inboxSheetConfigured() {
  return Boolean(String(getConfig().LINEWORKS_INBOX_SHEET_ID || "").trim());
}

/**
 * LINEWORKS受信箱シート(中継GASが書き込むシート)を直接読む。
 * 重要: 行の「取得状態」列は変更しない(PC版のポーリングと並走するため)。
 */
function fetchInboxMessages() {
  var config = getConfig();
  var sheetId = String(config.LINEWORKS_INBOX_SHEET_ID || "").trim();
  if (!sheetId) return null;
  var ss = SpreadsheetApp.openById(sheetId);
  var sheet = ss.getSheetByName(String(config.LINEWORKS_INBOX_SHEET_NAME || "lineworks_inbox"));
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var rows = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  var messages = [];
  for (var i = 0; i < rows.length; i++) {
    messages.push({
      postedAt: Object.prototype.toString.call(rows[i][0]) === "[object Date]" ? rows[i][0].toISOString() : String(rows[i][0] || ""),
      id: String(rows[i][1] || ""),
      room: String(rows[i][2] || ""),
      sender: String(rows[i][3] || ""),
      text: String(rows[i][4] || "")
    });
  }
  return messages;
}

function ingestInboxMessages(messages) {
  var processedList = readProcessedIds();
  var processed = {};
  processedList.forEach(function (id) { processed[id] = true; });
  var intake = readIntake();
  var manifests = readManifests();
  var added = 0;
  var skipped = 0;
  var list = Array.isArray(messages) ? messages : [];
  for (var i = 0; i < list.length; i++) {
    var message = list[i];
    var text = String((message && message.text) || "").trim();
    if (!text) continue;
    var key = String((message && message.id) || hashText((message.sender || "") + "|" + (message.postedAt || "") + "|" + text));
    if (processed[key]) continue;
    processed[key] = true;
    processedList.push(key);
    var blocks = splitLineworksLog(text);
    if (!blocks.length) {
      skipped++;
      continue;
    }
    for (var b = 0; b < blocks.length; b++) {
      var block = blocks[b];
      var parsed = parseLineworksText(block.text);
      parsed.requestedBy = String(message.sender || block.requestedBy || "").trim();
      var analysis = analyzeManifestDraft(mergeObjects(parsed, { status: "未作成" }), manifests);
      intake.push({
        id: newId("IN-"),
        receivedAt: new Date().toISOString(),
        postedAt: String(message.postedAt || ""),
        room: String(message.room || ""),
        sender: parsed.requestedBy,
        text: block.text,
        parsed: parsed,
        warnings: analysis.warnings,
        duplicateCandidates: analysis.duplicateCandidates
      });
      added++;
    }
  }
  writeProcessedIds(processedList);
  if (added) writeIntake(intake);
  return { added: added, skipped: skipped, pending: intake.length };
}

function hashText(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, text, Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? "0" + v : v;
  }).join("");
}

function pollInboxOnce() {
  if (!inboxSheetConfigured()) return null;
  try {
    var messages = fetchInboxMessages();
    var result = ingestInboxMessages(messages || []);
    writeStateValues({ inboxLastPollAt: new Date().toISOString(), inboxLastError: "" });
    return result;
  } catch (error) {
    writeStateValues({ inboxLastPollAt: new Date().toISOString(), inboxLastError: String(error.message || error) });
    return null;
  }
}

/** 画面を開いたとき、120秒以上あいていれば自動で受信箱を取り込む */
function maybeAutoPollInbox() {
  try {
    if (!inboxSheetConfigured()) return;
    var state = readState();
    var last = state.inboxLastPollAt ? new Date(state.inboxLastPollAt).getTime() : 0;
    if (Date.now() - last < 120000) return;
    withLock(function () { return pollInboxOnce(); });
  } catch (error) {
    // 表示は続行
  }
}

function inboxStatus() {
  var state = readState();
  return {
    configured: inboxSheetConfigured(),
    pollSeconds: 120,
    lastPollAt: state.inboxLastPollAt || "",
    lastError: state.inboxLastError || "",
    pending: readIntake().length
  };
}

function registerIntakeItem(id, overrides) {
  var intake = readIntake();
  var index = -1;
  for (var i = 0; i < intake.length; i++) {
    if (intake[i].id === id) { index = i; break; }
  }
  if (index === -1) {
    var notFound = new Error("対象の受信依頼が見つかりません。");
    notFound.statusCode = 404;
    throw notFound;
  }
  var item = intake[index];
  var manifest = addManifest(mergeObjects(mergeObjects(item.parsed || {}, overrides || {}), {
    sourceRoom: item.room || (item.parsed && item.parsed.sourceRoom) || "LCC現場地図",
    lineworksText: item.text,
    requestSource: "LINEWORKS 自動取込",
    by: String((overrides && overrides.by) || "受信箱")
  }));
  intake.splice(index, 1);
  writeIntake(intake);
  return manifest;
}

function dismissIntakeItem(id) {
  var intake = readIntake();
  var next = intake.filter(function (item) { return item.id !== id; });
  if (next.length === intake.length) {
    var notFound = new Error("対象の受信依頼が見つかりません。");
    notFound.statusCode = 404;
    throw notFound;
  }
  writeIntake(next);
  return { ok: true, pending: next.length };
}

// ============================== メール共有受信箱 ==============================

function readMailTickets() {
  return readRecords(SHEET_MAIL, MAIL_HEADERS, MAIL_JSON_KEYS)
    .map(normalizeMailTicket)
    .sort(compareMailTickets);
}

function writeMailTickets(tickets) {
  var normalized = tickets.map(normalizeMailTicket).sort(compareMailTickets);
  writeRecords(SHEET_MAIL, MAIL_HEADERS, MAIL_JSON_KEYS, normalized);
  return normalized;
}

function normalizeMailTicket(item) {
  var now = new Date().toISOString();
  var id = String(item.id || item.gmailId || item.threadId || "manual:" + Utilities.getUuid().slice(0, 10));
  var notes = Array.isArray(item.notes) ? item.notes : [];
  var history = Array.isArray(item.history) ? item.history : [];
  return {
    id: id,
    gmailId: item.gmailId || "",
    threadId: item.threadId || "",
    subject: String(item.subject || "(件名なし)"),
    from: String(item.from || ""),
    receivedAt: item.receivedAt || item.createdAt || now,
    updatedAt: item.updatedAt || item.receivedAt || now,
    category: mailCategoryOptions.indexOf(item.category) >= 0 ? item.category : "その他",
    status: mailStatusOptions.indexOf(item.status) >= 0 ? item.status : "未対応",
    assignee: String(item.assignee || ""),
    priority: mailPriorityOptions.indexOf(item.priority) >= 0 ? item.priority : "中",
    dueDate: item.dueDate || "",
    excerpt: String(item.excerpt || item.body || ""),
    actionSummary: String(item.actionSummary || "内容確認が必要です。"),
    notes: notes.map(normalizeMailNote).filter(function (note) { return note.text; }),
    history: history.map(normalizeMailNote).filter(function (note) { return note.summary || note.text; }).slice(0, 50),
    source: item.source || (item.gmailId ? "gmail" : "manual"),
    gmailUrl: item.gmailUrl || (item.gmailId ? "https://mail.google.com/mail/#all/" + item.gmailId : "")
  };
}

function normalizeMailNote(note) {
  return {
    at: note.at || new Date().toISOString(),
    by: String(note.by || "共有受信箱"),
    text: String(note.text || ""),
    summary: String(note.summary || "")
  };
}

function compareMailTickets(a, b) {
  var statusRank = { "未対応": 0, "対応中": 1, "返信待ち": 2, "完了": 3 };
  var priorityRank = { "高": 0, "中": 1, "低": 2 };
  return (valueOr(statusRank[a.status], 9)) - (valueOr(statusRank[b.status], 9))
    || (valueOr(priorityRank[a.priority], 9)) - (valueOr(priorityRank[b.priority], 9))
    || String(b.receivedAt || "").localeCompare(String(a.receivedAt || ""));
}

function buildMailSummary(tickets) {
  if (!tickets) tickets = readMailTickets();
  var active = tickets.filter(function (item) { return item.status !== "完了"; });
  var today = new Date().toISOString().slice(0, 10);
  return {
    total: tickets.length,
    active: active.length,
    unhandled: tickets.filter(function (item) { return item.status === "未対応"; }).length,
    doing: tickets.filter(function (item) { return item.status === "対応中"; }).length,
    waiting: tickets.filter(function (item) { return item.status === "返信待ち"; }).length,
    done: tickets.filter(function (item) { return item.status === "完了"; }).length,
    highPriority: active.filter(function (item) { return item.priority === "高"; }).length,
    overdue: active.filter(function (item) { return item.dueDate && item.dueDate < today; }).length,
    today: today
  };
}

function updateMailTicket(id, body) {
  var tickets = readMailTickets();
  var index = -1;
  for (var i = 0; i < tickets.length; i++) {
    if (tickets[i].id === id) { index = i; break; }
  }
  if (index === -1) {
    var notFound = new Error("対象メールが見つかりません。");
    notFound.statusCode = 404;
    throw notFound;
  }
  var before = tickets[index];
  if (body.expectedUpdatedAt && before.updatedAt !== body.expectedUpdatedAt) {
    var conflict = new Error("他の人が先に更新しています。画面を更新してからもう一度確認してください。");
    conflict.statusCode = 409;
    conflict.ticket = before;
    throw conflict;
  }
  var now = new Date().toISOString();
  var allowed = ["status", "assignee", "category", "priority", "dueDate", "actionSummary"];
  var patch = {};
  for (var a = 0; a < allowed.length; a++) {
    if (Object.prototype.hasOwnProperty.call(body, allowed[a])) patch[allowed[a]] = body[allowed[a]];
  }
  var next = normalizeMailTicket(mergeObjects(mergeObjects(before, patch), { updatedAt: now }));
  next.history = [{
    at: now,
    by: String(body.by || body.actor || next.assignee || "共有受信箱"),
    summary: summarizeMailChanges(before, next)
  }].concat(before.history || []).slice(0, 50);
  tickets[index] = next;
  var saved = writeMailTickets(tickets);
  return findById(saved, id);
}

function summarizeMailChanges(before, after) {
  var labels = {
    status: "状態",
    assignee: "担当",
    category: "分類",
    priority: "優先度",
    dueDate: "期限",
    actionSummary: "対応メモ"
  };
  var changes = Object.keys(labels)
    .filter(function (key) { return String(before[key] || "") !== String(after[key] || ""); })
    .map(function (key) { return labels[key] + ": " + (before[key] || "-") + " -> " + (after[key] || "-"); });
  return changes.length ? changes.join(" / ") : "内容更新";
}

function addMailTicketNote(id, body) {
  var tickets = readMailTickets();
  var index = -1;
  for (var i = 0; i < tickets.length; i++) {
    if (tickets[i].id === id) { index = i; break; }
  }
  if (index === -1) {
    var notFound = new Error("対象メールが見つかりません。");
    notFound.statusCode = 404;
    throw notFound;
  }
  var text = String(body.text || "").trim();
  if (!text) throw new Error("メモ本文を入力してください。");
  var now = new Date().toISOString();
  var note = { at: now, by: String(body.by || body.actor || tickets[index].assignee || "共有受信箱"), text: text };
  tickets[index] = normalizeMailTicket(mergeObjects(tickets[index], {
    updatedAt: now,
    notes: [note].concat(tickets[index].notes || []),
    history: [{ at: now, by: note.by, summary: "メモ追加" }].concat(tickets[index].history || []).slice(0, 50)
  }));
  var saved = writeMailTickets(tickets);
  return findById(saved, id);
}

function addMailTicket(body) {
  var now = new Date().toISOString();
  var classified = classifyMailDraft(body);
  var ticket = normalizeMailTicket(mergeObjects(mergeObjects(classified, body), {
    id: "manual:" + Utilities.getUuid().slice(0, 10),
    receivedAt: body.receivedAt || now,
    updatedAt: now,
    source: "manual",
    notes: body.note ? [{ at: now, by: String(body.by || body.actor || "手動登録"), text: String(body.note) }] : [],
    history: [{ at: now, by: String(body.by || body.actor || "手動登録"), summary: "手動登録" }]
  }));
  if (!ticket.subject || ticket.subject === "(件名なし)") throw new Error("件名を入力してください。");
  var tickets = readMailTickets();
  tickets.unshift(ticket);
  var saved = writeMailTickets(tickets);
  return findById(saved, ticket.id);
}

function classifyMailDraft(body) {
  var text = ((body.subject || "") + " " + (body.from || "") + " " + (body.excerpt || "")).toLowerCase();
  if (/請求|invoice|支払|振込|領収|契約|注文書|請書/.test(text)) {
    return { category: "請求・契約", assignee: "経理", priority: /至急|重要|督促|期限/.test(text) ? "高" : "中", status: "未対応", actionSummary: "請求・契約内容を確認してください。" };
  }
  if (/見積|現場|案件|工事|施工|クラウドサイン/.test(text)) {
    return { category: "案件", assignee: "営業", priority: "高", status: "未対応", actionSummary: "案件対応または返信要否を確認してください。" };
  }
  if (/採用|求人|応募|面接|労務|給与|freee/.test(text)) {
    return { category: "採用・人事", assignee: "事務", priority: "中", status: "未対応", actionSummary: "人事・労務関連の確認が必要です。" };
  }
  if (/認証|ログイン|コード|通知|セキュリティ/.test(text)) {
    return { category: "システム通知", assignee: "", priority: "低", status: "完了", actionSummary: "通知メールです。通常は対応不要です。" };
  }
  if (/newsletter|news|メルマガ|キャンペーン|セミナー|広告/.test(text)) {
    return { category: "営業・メルマガ", assignee: "", priority: "低", status: "完了", actionSummary: "案内メールです。通常は対応不要です。" };
  }
  return { category: "その他", assignee: "", priority: "中", status: "未対応", actionSummary: "内容確認が必要です。" };
}

function deleteMailTicket(id) {
  var tickets = readMailTickets();
  var next = tickets.filter(function (ticket) { return ticket.id !== id; });
  if (next.length === tickets.length) {
    var notFound = new Error("対象メールが見つかりません。");
    notFound.statusCode = 404;
    throw notFound;
  }
  writeMailTickets(next);
  return { ok: true, summary: buildMailSummary(next) };
}

function mailGmailDiagnostics() {
  var config = getConfig();
  return {
    configured: true,
    missing: [],
    mode: "GAS直接(GmailApp)",
    query: config.GMAIL_QUERY,
    maxResults: Number(config.GMAIL_MAX_RESULTS) || 200
  };
}

function buildMailInviteText() {
  var mainUrl = webAppUrl();
  return [
    "info@lcc55.com 共有受信箱",
    "",
    "開く: " + mainUrl + "?page=mail",
    "",
    "使い方:",
    "1. 自分の名前を左側に入れる",
    "2. 対応するメールの担当を自分にする",
    "3. 対応中・返信待ち・完了へ状態を変える",
    "4. 電話や確認した内容はメモに残す",
    "",
    "現場準備台帳(マニフェスト・道具・備品)は " + mainUrl + " です。"
  ].join("\n");
}

// ---- Gmail取込(GmailAppで直接。中継GASと同じロジック) ----

function fetchGmailMessages(queryOverride, maxOverride) {
  var config = getConfig();
  var query = queryOverride || config.GMAIL_QUERY;
  var max = Math.min(maxOverride || Number(config.GMAIL_MAX_RESULTS) || 25, 500);
  var threads = [];
  for (var start = 0; start < max; start += 50) {
    var page = GmailApp.search(query, start, Math.min(50, max - start));
    for (var i = 0; i < page.length; i++) threads.push(page[i]);
    if (page.length < 50) break;
  }
  var messages = [];
  threads.forEach(function (thread) {
    var msgs = thread.getMessages();
    var msg = msgs[msgs.length - 1];
    // メール内部IDはメールボックスごとに異なるため、全員共通のMessage-IDヘッダで検索するURLにする。
    var rfcId = "";
    try { rfcId = String(msg.getHeader("Message-ID") || "").replace(/[<>]/g, ""); } catch (err) { rfcId = ""; }
    var gmailUrl = rfcId
      ? "https://mail.google.com/mail/#search/" + encodeURIComponent("rfc822msgid:" + rfcId)
      : "https://mail.google.com/mail/#all/" + msg.getId();
    messages.push({
      id: msg.getId(),
      threadId: thread.getId(),
      subject: msg.getSubject(),
      from: msg.getFrom(),
      receivedAt: msg.getDate().toISOString(),
      excerpt: String(msg.getPlainBody() || "").replace(/\s+/g, " ").slice(0, 160),
      gmailUrl: gmailUrl
    });
  });
  return messages;
}

function relayMessageToTicket(message) {
  var subject = message.subject || "(no subject)";
  var from = message.from || "Unknown sender";
  var receivedAt = message.receivedAt || new Date().toISOString();
  var classification = classifyEmail({ subject: subject, from: from, snippet: message.excerpt || "", receivedAt: receivedAt });
  return {
    id: "gmail:" + message.id,
    gmailId: message.id,
    threadId: message.threadId || "",
    subject: subject,
    from: from,
    receivedAt: receivedAt,
    updatedAt: receivedAt,
    category: classification.category,
    status: classification.status,
    assignee: classification.assignee,
    priority: classification.priority,
    dueDate: classification.dueDate,
    workKey: classification.workKey,
    actionSummary: classification.actionSummary,
    classifierRule: classification.rule,
    excerpt: message.excerpt || "",
    notes: [],
    history: [],
    source: "gmail",
    gmailUrl: message.gmailUrl || ("https://mail.google.com/mail/#all/" + message.id)
  };
}

function mergeTickets(existing, imported) {
  var byId = {};
  existing.forEach(function (ticket) { byId[ticket.id] = ticket; });
  var created = 0;
  for (var i = 0; i < imported.length; i++) {
    var ticket = imported[i];
    if (byId[ticket.id]) {
      var current = byId[ticket.id];
      current.subject = ticket.subject;
      current.from = ticket.from;
      current.receivedAt = ticket.receivedAt;
      current.excerpt = ticket.excerpt;
      current.gmailUrl = ticket.gmailUrl;
      current.threadId = ticket.threadId;
      current.gmailId = ticket.gmailId;
      current.source = ticket.source;
      current.dueDate = current.dueDate || ticket.dueDate;
      current.workKey = current.workKey || ticket.workKey;
      current.actionSummary = ticket.actionSummary;
      current.classifierRule = ticket.classifierRule;
    } else {
      existing.unshift(ticket);
      created += 1;
    }
  }
  reconcileTickets(existing);
  return { tickets: existing, created: created, imported: imported.length };
}

function importMailFromGmail() {
  var imported = reconcileTickets(fetchGmailMessages().map(relayMessageToTicket));
  var result = mergeTickets(readMailTickets(), imported);
  writeMailTickets(result.tickets);
  writeStateValues({ gmailLastImportAt: new Date().toISOString() });
  return { created: result.created, imported: result.imported, summary: buildMailSummary(result.tickets) };
}

/** 30分以上あいていれば自動でGmail取込する(表示をブロックしないよう画面表示後に呼ばれる) */
function maybeAutoImportGmail() {
  try {
    if (!isGmailImportDue()) return null;
    return withLock(function () {
      if (!isGmailImportDue()) return null; // ロック待ちの間に別の実行が取込済み
      return importMailFromGmail();
    });
  } catch (error) {
    return null; // 失敗しても表示は続行
  }
}

function isGmailImportDue() {
  var state = readState();
  var last = state.gmailLastImportAt ? new Date(state.gmailLastImportAt).getTime() : 0;
  return Date.now() - last >= 30 * 60 * 1000;
}

// ============================== メール自動分類 (lib/classifier.js 移植) ==============================

var DAY_MS = 24 * 60 * 60 * 1000;

var classifierRules = [
  {
    name: "auth-noise", category: "システム通知", status: "完了", assignee: "", priority: "低",
    when: function (text) { return hasAny(text, ["ログインコード", "ログイン通知", "ビジネスID"]); }
  },
  {
    name: "cloudsign-complete", category: "請求・契約", status: "完了", assignee: "坂本", priority: "中",
    when: function (text) { return hasAny(text, ["クラウドサイン", "注文書", "請書"]) && hasAny(text, ["合意締結が完了", "締結完了"]); }
  },
  {
    name: "cloudsign-request", category: "請求・契約", status: "未対応", assignee: "坂本", priority: "高",
    when: function (text) { return hasAny(text, ["クラウドサイン", "注文書", "請書"]) && hasAny(text, ["確認依頼", "同意して確認完了", "までに締結"]); }
  },
  {
    name: "invoice", category: "請求・契約", status: "未対応", assignee: "経理", priority: "中",
    when: function (text) { return hasAny(text, ["請求書", "invoice", "領収書", "支払", "Digital Billder"]); }
  },
  {
    name: "mitsumoa-action", category: "案件", status: "未対応", assignee: "現場担当", priority: "高",
    when: function (text) { return hasAny(text, ["ミツモア", "meetsmore.com", "meetsmore"]) && hasAny(text, ["要承諾", "日程リクエスト", "メッセージ", "返信しましょう", "現地決済", "承諾", "message"]); }
  },
  {
    name: "mitsumoa-followup", category: "案件", status: "未対応", assignee: "現場担当", priority: "中",
    when: function (text) { return hasAny(text, ["ミツモア", "meetsmore.com", "meetsmore"]) && hasAny(text, ["案件の確認", "成約", "フォローアップ", "最後のやりとり", "手続き"]); }
  },
  {
    name: "zehitomo-action", category: "案件", status: "未対応", assignee: "現場担当", priority: "高",
    when: function (text) { return hasAny(text, ["ゼヒトモ", "zehitomo.com", "zehitomo"]) && hasAny(text, ["依頼が来ました", "今日のタスク", "対応案件", "案件", "メッセージ", "依頼", "task"]); }
  },
  {
    name: "web-form", category: "案件", status: "未対応", assignee: "事務A", priority: "中",
    when: function (text) { return hasAny(text, ["お問い合わせ", "問い合わせ", "ご質問", "リノベーション不動産しまね"]); }
  },
  {
    name: "hr", category: "採用・人事", status: "未対応", assignee: "事務A", priority: "中",
    when: function (text) { return hasAny(text, ["freee", "人事", "有給", "採用", "応募"]) && !hasAny(text, ["運用代行", "セミナー", "無料DL"]); }
  },
  {
    name: "newsletter", category: "営業・メルマガ", status: "完了", assignee: "", priority: "低",
    when: function (text) {
      return hasAny(text, ["メルマガ", "セミナー", "キャンペーン", "会員様限定", "無料DL", "NEWS", "ニュース", "お知らせメール", "船井総研", "ラクスル", "助成金", "Sansan", "ジョブメドレー", "job-medley", "jobmedley", "OFFICE DE YASAI"]);
    }
  }
];

function classifyEmail(input) {
  var text = String((input.subject || "") + " " + (input.from || "") + " " + (input.snippet || "")).toLowerCase();
  var matched = null;
  for (var i = 0; i < classifierRules.length; i++) {
    if (classifierRules[i].when(text)) { matched = classifierRules[i]; break; }
  }
  var base = matched || { name: "default", category: "その他", status: "未対応", assignee: "", priority: "中" };
  var dueDate = inferDueDate(text, input.receivedAt || "", base);
  return {
    rule: base.name,
    category: base.category,
    status: base.status,
    assignee: base.assignee,
    priority: base.priority,
    dueDate: dueDate,
    workKey: inferWorkKey(text),
    actionSummary: inferActionSummary(text, base)
  };
}

function reconcileTickets(tickets) {
  var byWorkKey = {};
  tickets.forEach(function (ticket) {
    if (!ticket.workKey) return;
    (byWorkKey[ticket.workKey] = byWorkKey[ticket.workKey] || []).push(ticket);
  });
  Object.keys(byWorkKey).forEach(function (key) {
    var list = byWorkKey[key];
    var completed = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].status === "完了" && /締結|完了/.test((list[i].subject || "") + " " + (list[i].excerpt || ""))) {
        completed = list[i];
        break;
      }
    }
    if (!completed) return;
    list.forEach(function (ticket) {
      if (ticket.status === "未対応" && /確認依頼|再送/.test(ticket.subject || "")) {
        ticket.status = "完了";
        ticket.priority = "低";
        ticket.actionSummary = "後続の締結完了メールを確認済み。同一案件の確認依頼は完了扱い。";
      }
    });
  });
  return tickets;
}

function inferDueDate(text, receivedAt, rule) {
  var dateMatch = text.match(/(\d{1,2})\/(\d{1,2})まで/);
  var baseYear = baseYearFrom(receivedAt);
  if (dateMatch) {
    return baseYear + "-" + padStart2(dateMatch[1]) + "-" + padStart2(dateMatch[2]);
  }
  if (rule.name === "mitsumoa-action" || rule.name === "zehitomo-action") return addDaysToDateString(receivedAt, 1);
  if (rule.name === "cloudsign-request") return addDaysToDateString(receivedAt, 2);
  if (rule.name === "invoice") return addDaysToDateString(receivedAt, 7);
  return "";
}

function baseYearFrom(value) {
  var match = String(value || "").match(/^(\d{4})-/);
  return match ? match[1] : String(new Date().getFullYear());
}

function addDaysToDateString(value, days) {
  var match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  var date = match
    ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days))
    : new Date(Date.now() + days * DAY_MS);
  return date.toISOString().slice(0, 10);
}

function inferWorkKey(text) {
  var bracketCode = text.match(/【([0-9]{3,4}-[0-9]{1,4})】/);
  if (bracketCode) return bracketCode[1];
  var plainCode = text.match(/\b([0-9]{3,4}-[0-9]{1,4})\b/);
  if (plainCode) return plainCode[1];
  var person = text.match(/([一-龥ぁ-んァ-ヶA-Za-z]{2,12})様/);
  if (person && hasAny(text, ["ミツモア", "ゼヒトモ", "クラウドサイン"])) return person[1];
  return "";
}

function inferActionSummary(text, rule) {
  if (rule.name === "auth-noise") return "ログイン関連の通知。対応管理からは除外。";
  if (rule.name === "cloudsign-complete") return "締結完了。必要ならPDF保存のみ。";
  if (rule.name === "cloudsign-request") return "クラウドサイン上で内容確認と締結が必要。";
  if (rule.name === "invoice") return "請求書または支払い関連。経理確認が必要。";
  if (rule.name === "mitsumoa-action") return "ミツモア上で返信・承諾・日程確認が必要。";
  if (rule.name === "mitsumoa-followup") return "ミツモア案件の成約状況または後続手続きの確認が必要。";
  if (rule.name === "zehitomo-action") return "ゼヒトモ上で案件確認または顧客連絡が必要。";
  if (rule.name === "hr") return "人事・採用関連の確認が必要。";
  if (rule.name === "newsletter") return "営業/案内メール。通常は対応不要。";
  return "内容確認が必要。";
}

function hasAny(text, words) {
  for (var i = 0; i < words.length; i++) {
    if (text.indexOf(String(words[i]).toLowerCase()) >= 0) return true;
  }
  return false;
}

// ============================== CSV出力 ==============================

function toCsv(manifests) {
  var headers = ["id", "依頼種別", "現場名", "現場住所", "請求先/元請", "必要日", "着工日", "部数", "マニフェスト種類", "マニフェスト内訳", "発生元チャット", "排出事業者", "運搬業者", "運搬先", "廃棄物番号", "廃棄物種類", "数量", "単位", "状態", "担当", "地図", "依頼者", "優先度", "未入力", "メモ"];
  var rows = manifests.map(function (item) {
    return [
      item.id, item.requestType, item.siteName, item.siteAddress, item.contractorName,
      item.neededDate, item.startDate, item.copies, item.manifestKind, item.manifestBreakdown,
      item.sourceRoom, item.generator, item.transporter, item.destination, item.wasteNumber,
      item.wasteTypes, item.quantity, item.unit, item.status, item.owner, item.mapStatus,
      item.requestedBy, item.priority, (item.missingFields || []).join("・"), item.notes
    ];
  });
  return [headers].concat(rows).map(function (row) {
    return row.map(csvCell).join(",");
  }).join("\n");
}

function csvCell(value) {
  var text = String(value === null || value === undefined ? "" : value);
  return '"' + text.replace(/"/g, '""') + '"';
}

// ============================== 初回セットアップ ==============================

/**
 * 【初回に1回だけ実行】
 * 1. データ用スプレッドシートを作成(タブ: 台帳/メール/受信箱/ユーザー/設定/状態)
 * 2. Driveの「マニフェスト台帳GAS化データ」フォルダから初期データ(JSON)を取込
 * 3. LINEWORKS受信箱シートの既存行をすべて「処理済み」として記録(過去分の再取込防止)
 * 実行後、ログにデータ用スプレッドシートのURLが出る。
 */
function setup() {
  var ss = dataSpreadsheet();
  ensureSheet(SHEET_MANIFESTS, MANIFEST_HEADERS);
  ensureSheet(SHEET_MAIL, MAIL_HEADERS);
  ensureSheet(SHEET_INTAKE, INTAKE_HEADERS);
  ensureSheet(SHEET_USERS, ["name"]);
  ensureSheet(SHEET_CONFIG, ["key", "value"]);
  ensureSheet(SHEET_STATE, ["key", "value"]);
  seedConfigSheet();
  var defaultSheet = ss.getSheetByName("シート1") || ss.getSheetByName("Sheet1");
  if (defaultSheet && ss.getSheets().length > 1) ss.deleteSheet(defaultSheet);
  importInitialDataFromDrive();
  markExistingInboxAsProcessed();
  initialGmailBackfill();
  Logger.log("データ用スプレッドシート: " + ss.getUrl());
  Logger.log("セットアップ完了。次は「デプロイ → 新しいデプロイ → ウェブアプリ (アクセス: lcc55.com内の全員)」です。");
}

/**
 * 過去45日分のinfo@宛メールをGmailから取得して自動分類で復元する。
 * 何度実行しても既存チケット(状態・担当・メモ)は上書きされない(idでマージ)。
 * メール件数が多いと数分かかる。6分制限で止まった場合は setup() をもう一度実行すれば続きから入る。
 */
function initialGmailBackfill() {
  try {
    var query = "{to:info@lcc55.com deliveredto:info@lcc55.com} newer_than:45d -in:spam -in:trash";
    var imported = reconcileTickets(fetchGmailMessages(query, 500).map(relayMessageToTicket));
    var result = mergeTickets(readMailTickets(), imported);
    writeMailTickets(result.tickets);
    writeStateValues({ gmailLastImportAt: new Date().toISOString() });
    Logger.log("Gmailバックフィル: 新規" + result.created + "件 / 取得" + result.imported + "件");
  } catch (error) {
    Logger.log("Gmailバックフィルに失敗(後で画面の「Gmailから取り込む」でも取込可能): " + error.message);
  }
}

function importInitialDataFromDrive() {
  var folders = DriveApp.getFoldersByName(IMPORT_FOLDER_NAME);
  if (!folders.hasNext()) {
    Logger.log("初期データフォルダ「" + IMPORT_FOLDER_NAME + "」が見つかりません。空の状態で開始します。");
    return;
  }
  var folder = folders.next();
  var read = function (name) {
    var files = folder.getFilesByName(name);
    if (!files.hasNext()) return null;
    try {
      return JSON.parse(files.next().getBlob().getDataAsString("UTF-8"));
    } catch (error) {
      Logger.log(name + " の読み込みに失敗: " + error.message);
      return null;
    }
  };

  if (ensureSheet(SHEET_MANIFESTS, MANIFEST_HEADERS).getLastRow() < 2) {
    var manifests = read("manifests.json");
    if (Array.isArray(manifests)) {
      writeManifests(manifests);
      Logger.log("台帳: " + manifests.length + "件を取込");
    }
  }
  if (ensureSheet(SHEET_MAIL, MAIL_HEADERS).getLastRow() < 2) {
    // tickets.json(全量) があればそれを、なければ tickets-touched.json(人が状態変更した分だけ) を取込。
    // 残りは initialGmailBackfill() がGmailから再取得し、同じルールで自動分類して復元する。
    var tickets = read("tickets.json") || read("tickets-touched.json");
    if (Array.isArray(tickets)) {
      writeMailTickets(tickets);
      Logger.log("メール: " + tickets.length + "件を取込");
    }
  }
  if (ensureSheet(SHEET_INTAKE, INTAKE_HEADERS).getLastRow() < 2) {
    var intake = read("intake.json");
    if (Array.isArray(intake)) {
      writeIntake(intake.map(function (item) {
        return {
          id: item.id || newId("IN-"),
          receivedAt: item.receivedAt || "",
          postedAt: item.postedAt || "",
          room: item.room || "",
          sender: item.sender || "",
          text: item.text || "",
          parsed: item.parsed || {},
          warnings: item.warnings || [],
          duplicateCandidates: item.duplicateCandidates || []
        };
      }));
      Logger.log("受信箱: " + intake.length + "件を取込");
    }
  }
  var usersSheet = ensureSheet(SHEET_USERS, ["name"]);
  if (usersSheet.getLastRow() < 2) {
    var users = read("users.json");
    if (Array.isArray(users) && users.length) {
      usersSheet.getRange(2, 1, users.length, 1).setNumberFormat("@")
        .setValues(users.map(function (name) { return [String(name)]; }));
      Logger.log("ユーザー: " + users.length + "件を取込");
    }
  }
}

/**
 * LINEWORKS受信箱シートの既存行をすべて処理済みにする。
 * (過去のメッセージはPC版で取込済みのため。以後の新着だけをGAS版が拾う)
 */
function markExistingInboxAsProcessed() {
  if (!inboxSheetConfigured()) return;
  try {
    var messages = fetchInboxMessages() || [];
    var processed = readProcessedIds();
    var seen = {};
    processed.forEach(function (id) { seen[id] = true; });
    messages.forEach(function (message) {
      var key = String(message.id || hashText((message.sender || "") + "|" + (message.postedAt || "") + "|" + String(message.text || "").trim()));
      if (!seen[key]) {
        seen[key] = true;
        processed.push(key);
      }
    });
    writeProcessedIds(processed);
    Logger.log("LINEWORKS受信箱の既存 " + messages.length + " 行を処理済みとして記録しました。");
  } catch (error) {
    Logger.log("受信箱シートへのアクセスに失敗: " + error.message);
  }
}

/** 動作確認用: 台帳とメールの件数をログに出す */
function healthCheck() {
  Logger.log("台帳: " + readManifests().length + "件");
  Logger.log("メール: " + readMailTickets().length + "件");
  Logger.log("受信箱(未登録): " + readIntake().length + "件");
  Logger.log("データ: " + dataSpreadsheet().getUrl());
  Logger.log("Webアプリ: " + (webAppUrl() || "(未デプロイ)"));
}



/* 2026-07-18 現場台帳の朝通知を業務サポート依頼ルームへ戻す（設定シート優先のため必須）。実行後この関数は消してよい */
function REVERT_webhook_to_support() {
  const ss = SpreadsheetApp.getActiveSpreadsheet ? null : null;
  const bookId = '1rsgWG6n7d7_wZC4gpuJT2ED6GBN347usBR8rpyntHJI';
  const sh = SpreadsheetApp.openById(bookId).getSheetByName('設定');
  if (!sh) { console.log('設定シートなし'); return; }
  const rng = sh.getDataRange();
  const vals = rng.getValues();
  let done = 0;
  for (let r = 0; r < vals.length; r++) {
    for (let c = 0; c < vals[r].length; c++) {
      if (String(vals[r][c]).indexOf('28c9721b') >= 0) {
        sh.getRange(r+1, c+1).setValue('https://webhook.worksmobile.com/message/3e2040a1-b8d8-46fb-973e-10c0b5fc7d70');
        done++;
      }
    }
  }
  console.log('設定シート 置換件数: ' + done);
}


// ============ 会社の休日判定（2026-07-26） ============
// 「LCC株式会社」カレンダーに「休日」を含む終日予定がある日＝会社の休み。通知を止める判定に使う。
var LCC_KAISHA_CAL = "c_97cf15eafe09f9bcf0f686654e7a7d87754d75a8ce20a5201f82024fb7ca52d4@group.calendar.google.com";
function isCompanyClosed_(date){
  try{
    var cal = CalendarApp.getCalendarById(LCC_KAISHA_CAL);
    if(!cal) return false;
    var evs = cal.getEventsForDay(date);
    for(var i=0;i<evs.length;i++){ if(String(evs[i].getTitle()).indexOf("休日")>=0) return true; }
    return false;
  }catch(e){ return false; } // 判定不能時は従来どおり通知（フェイルオープ）
}
