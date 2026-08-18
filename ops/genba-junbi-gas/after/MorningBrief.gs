/** 朝ブリーフィング（毎朝7時・社長宛て） ★独立ファイル・既存コードには触れていません
 * 位置づけ: 社員向け通知（7:30現場準備・前日17時休暇など）はそのまま。これは「社長に情報を集める」ための1通。
 * 内容: ①今日必要な備品・マニフェスト ②info@未対応メール（前日比） ③配置板の入力状況
 * 宛先: 社長メール（sakamoto55@lcc55.com）。設定シートに BRIEF_WEBHOOK_URL を足せば社長専用LINE WORKSルームに切替可。
 * 会社休日はスキップ。同日二重送信ガードあり。2026-07-29 社長指示で新設。
 */
var MB_HAICHI_SS_ID = "19nu2KzprKgf5NOLxsgh-TXaau0zkjisx3d19Eia5MZ8"; // 日報データシート（配置板の保存先）
var MB_TO = "sakamoto55@lcc55.com";

function morningBriefSetupAndTest(){
  var b = morningBriefBuild_();
  Logger.log("=== 送信文プレビュー ===\n" + b.text);
  mbDeliver_("（テスト送信です。明日から毎朝7時に届きます）\n\n" + b.text);
  morningBriefInstallTrigger();
  Logger.log("テスト送信しました（宛先: " + MB_TO + " または BRIEF_WEBHOOK_URL）");
}

function mbDeliver_(text){
  // getConfig() は引数を取らず設定オブジェクトを返す。getConfig("BRIEF_WEBHOOK_URL") と呼ぶと
  // オブジェクトがそのまま返り、String() が "[object Object]" になって URL として fetch され、毎朝失敗していた。
  var url = "";
  try { url = String((getConfig() || {}).BRIEF_WEBHOOK_URL || "").trim(); } catch(e){ url = ""; }
  if (url) {
    UrlFetchApp.fetch(url, {
      method: "post", contentType: "application/json",
      payload: JSON.stringify({ content: { type: "text", text: text } }),
      muteHttpExceptions: true
    });
    return;
  }
  // Webhook 未設定でも止めない。ファイル冒頭の設計どおり社長メールへ届ける。
  MailApp.sendEmail(MB_TO, "☀️ 朝ブリーフィング " + todayJst(), text);
}

function morningBriefBuild_(){
  var today = todayJst();
  var dayIdx = Number(Utilities.formatDate(new Date(), "Asia/Tokyo", "u")) % 7; // 月=1..日=0
  var youbi = ["日","月","火","水","木","金","土"][dayIdx];
  var dispDate = Number(today.slice(5,7)) + "/" + Number(today.slice(8,10)) + "(" + youbi + ")";

  var due = [];
  try {
    var manifests = readManifests();
    for (var i = 0; i < manifests.length; i++){
      var m = manifests[i];
      var nd = String(m.neededDate || "");
      var st = String(m.status || "");
      if (!nd || nd > today) continue;
      if (/受渡|完了|キャンセル|不要/.test(st)) continue;
      due.push("・" + String(m.siteName||"") + " " + String(m.manifestBreakdown || m.manifestKind || ""));
    }
  } catch(e){ due = ["・(台帳の読み取りに失敗: " + e + ")"]; }
  var dueLines = due.slice(0, 6);
  if (due.length > 6) dueLines.push("　…ほか" + (due.length - 6) + "件");

  var pending = -1;
  try {
    var sh = SpreadsheetApp.openById(MC_SS_ID).getSheetByName(MC_MAIL);
    var vals = sh.getDataRange().getValues();
    pending = 0;
    for (var r = 1; r < vals.length; r++){
      if (String(vals[r][MC_COL_STAT-1]) === "未対応") pending++;
    }
  } catch(e){}
  var state = readState();
  var prev = Number(state.briefMailPending);
  var diff = "";
  if (pending >= 0 && !isNaN(prev)) {
    var d2 = pending - prev;
    diff = d2 === 0 ? "（前日と同じ）" : "（前日比" + (d2 > 0 ? "+" : "") + d2 + "）";
  }

  var haichiRows = -1, haichiLine = "";
  try {
    var hss = SpreadsheetApp.openById(MB_HAICHI_SS_ID);
    var sheets = hss.getSheets();
    haichiRows = 0;
    var found = false;
    for (var s = 0; s < sheets.length; s++){
      if (sheets[s].getName().indexOf("配置") < 0) continue;
      found = true;
      haichiRows += Math.max(0, sheets[s].getLastRow() - 1);
    }
    if (found){
      var prevRows = Number(state.briefHaichiRows);
      var inc = isNaN(prevRows) ? null : (haichiRows - prevRows);
      haichiLine = "🧲 配置板: " + (inc === null ? "累計" + haichiRows + "行" : "新規入力" + (inc > 0 ? "+" + inc + "行" : "なし") + "（累計" + haichiRows + "行）") + "（実験中）";
    }
  } catch(e){}

  var lines = [];
  lines.push("☀️ 朝ブリーフィング " + dispDate);
  lines.push("");
  lines.push("📦 今日の備品・マニフェスト: " + (due.length ? due.length + "件" : "なし"));
  for (var k = 0; k < dueLines.length; k++) lines.push(dueLines[k]);
  if (pending >= 0) lines.push("📬 info@未対応メール: " + pending + "件" + diff);
  if (haichiLine) lines.push(haichiLine);
  lines.push("");
  lines.push("※社員向けの現場準備通知は7:30に別途届きます");

  return { text: lines.join("\n"), mailPending: pending, haichiRows: haichiRows };
}

function sendMorningBrief(){
  if (typeof isCompanyClosed_ === "function" && isCompanyClosed_(new Date())){
    Logger.log("会社休日のためスキップ"); return;
  }
  var today = todayJst();
  var state = readState();
  if (String(state.briefLastDate || "") === today){ Logger.log("本日送信済み"); return; }
  var b = morningBriefBuild_();
  mbDeliver_(b.text);
  var patch = { briefLastDate: today };
  if (b.mailPending >= 0) patch.briefMailPending = String(b.mailPending);
  if (b.haichiRows >= 0) patch.briefHaichiRows = String(b.haichiRows);
  writeStateValues(patch);
  Logger.log("朝ブリーフィングを送信しました");
}

function morningBriefInstallTrigger(){
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++){
    if (triggers[i].getHandlerFunction() === "sendMorningBrief"){ Logger.log("トリガーは既に設置済み"); return; }
  }
  ScriptApp.newTrigger("sendMorningBrief").timeBased().everyDays(1).atHour(7).create();
  Logger.log("毎朝7時のトリガーを設置しました");
}

/** 案件ハブ LCC_CASE_DB の最小版を作る（2026-07-31 社長指示・ChatGPT設計の最小実装）
 * 方針: 6シート一気ではなく「01_projects + 06_events + 90_codes」の3枚から始める。
 * project_id は新規発番せず、統合業務システム(クラウドDB)の案件id をそのまま背骨にする。
 * 実行: caseHubSetup() を1回。何度実行しても壊れない（既存行はスキップ）。
 */
var CH_SRC_API = "https://script.google.com/macros/s/AKfycbxUzXad6qaHW8TIsmj3tmpFpvE2XlxGuB5_MELXqXqryz5L_HQi9MyehLXuO0cuKYU-/exec";
var CH_FOLDER  = "1n6WEzHKVRwGiPaJiW_2CC7XIpTZSj-SC"; // LCCアプリポータル配下
var CH_NAME    = "LCC_CASE_DB";
var CH_PROP    = "CASE_DB_ID";

var CH_PROJ_HEADERS = ["project_id","case_no","name","customer_name","site","status_code","stage","kind",
  "sales_owner","estimate_total","cost_budget","order_date","work_start","work_end",
  "drive_folder_id","haichi_key","integrated_id","board_id","is_active","created_at","updated_at","note"];
var CH_EVENT_HEADERS = ["event_id","at","actor","project_id","entity","action","field","before","after","reason","source"];
var CH_CODE_HEADERS  = ["group","code","label","order","note"];

function caseHubSetup(){
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(CH_PROP);
  var ss;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch(e) { id = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create(CH_NAME);
    props.setProperty(CH_PROP, ss.getId());
  }
  chEnsure_(ss, "01_projects", CH_PROJ_HEADERS);
  chEnsure_(ss, "06_events",   CH_EVENT_HEADERS);
  chEnsure_(ss, "90_codes",    CH_CODE_HEADERS);
  var first = ss.getSheets()[0];
  if (first.getName() === "シート1" || first.getName() === "Sheet1") { try { ss.deleteSheet(first); } catch(e){} }
  chSeedCodes_(ss);
  var n = chImportProjects_(ss);
  Logger.log("LCC_CASE_DB 準備完了\nURL: " + ss.getUrl() + "\n新規取込: " + n + "件");
  return ss.getUrl();
}

function chEnsure_(ss, name, headers){
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight("bold");
    sh.setFrozenRows(1);
  }
  return sh;
}

function chSeedCodes_(ss){
  var sh = ss.getSheetByName("90_codes");
  if (sh.getLastRow() > 1) return;
  var rows = [
    ["status","lead","見込",10,""],
    ["status","survey","現調",20,""],
    ["status","quote","見積提出",30,"統合業務システムのquote"],
    ["status","contract","受注",40,"統合業務システムのcontract"],
    ["status","working","施工中",50,""],
    ["status","done","完工",60,""],
    ["status","lost","失注",70,""],
    ["work_state","open","未着手",10,""],
    ["work_state","doing","対応中",20,""],
    ["work_state","waiting_external","先方待ち",30,"行政の受理待ちなど"],
    ["work_state","waiting_approval","社長承認待ち",40,""],
    ["work_state","done","完了",50,""],
    ["dept","sales","営業",10,""],
    ["dept","office","事務",20,""],
    ["dept","legal","法務",30,"解体届出・マニフェスト等"],
    ["dept","field","工務",40,""],
    ["doc_type","demolition_notice","解体届出",10,""],
    ["doc_type","recycle_law","リサイクル法届出",20,""],
    ["doc_type","asbestos","石綿事前調査",30,""],
    ["doc_type","manifest","マニフェスト",40,""],
    ["doc_type","contract","工事請負契約書",50,""],
    ["doc_type","invoice","請求書",60,""]
  ];
  sh.getRange(2,1,rows.length,CH_CODE_HEADERS.length).setValues(rows);
}

function chImportProjects_(ss){
  var sh = ss.getSheetByName("01_projects");
  var existing = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2,1,sh.getLastRow()-1,1).getValues().forEach(function(r){ existing[String(r[0])] = true; });
  }
  var res = UrlFetchApp.fetch(CH_SRC_API + "?action=pull", {muteHttpExceptions:true});
  var data = JSON.parse(res.getContentText());
  var custById = {};
  (data.customers||[]).forEach(function(c){ if(c && c.id) custById[c.id] = c.name || c.shortName || ""; });
  var now = new Date().toISOString();
  var rows = [];
  (data.projects||[]).forEach(function(p){
    if (!p || !p.id || existing[p.id]) return;
    if (String(p.status) !== "contract") return;
    rows.push([
      p.id, p.no || "", p.name || "", custById[p.customerId] || p.customerName || "", p.site || "",
      p.status || "", "", p.kind || "", p.staff || "",
      Number(p.estimateTotal||0), Number(p.costBudget||0),
      p.orderDate || "", p.workStart || "", p.workEnd || "",
      "", "", p.id, p.boardId || "", "TRUE", now, now,
      "2026-07-31 統合業務システムから初期取込(受注のみ)"
    ]);
  });
  if (rows.length) sh.getRange(sh.getLastRow()+1, 1, rows.length, CH_PROJ_HEADERS.length).setValues(rows);
  var ev = ss.getSheetByName("06_events");
  ev.appendRow(["ev_" + Utilities.getUuid().slice(0,8), now, "Claude", "", "01_projects", "import", "", "", String(rows.length) + "件", "案件ハブ最小版の初期構築", "統合業務システムAPI"]);
  return rows.length;
}

function caseHubUrl(){
  var id = PropertiesService.getScriptProperties().getProperty(CH_PROP);
  Logger.log(id ? SpreadsheetApp.openById(id).getUrl() : "未作成");
}

/** 05_documents: 法定書類の期限管理シートを追加（2026-07-31 案件ハブ次の一手①）
 * 受注案件のうち解体系に 解体届出・石綿事前調査・マニフェスト の3行を「要確認」で生成する。
 * 要・不要は法務が判断する設計。何度実行しても既存の(案件×書類種別)は作り直さない。
 */
var CH_DOC_HEADERS = ["doc_id","project_id","doc_type","title","submit_to","control_no","doc_state","due_at","submitted_at","accepted_at","owner_dept","owner","drive_file_id","version","is_active","created_at","updated_at","note"];

function caseHubAddDocs(){
  var id = PropertiesService.getScriptProperties().getProperty(CH_PROP);
  if (!id) { Logger.log("LCC_CASE_DB未作成。先にcaseHubSetup()を実行"); return 0; }
  var ss = SpreadsheetApp.openById(id);
  var sh = chEnsure_(ss, "05_documents", CH_DOC_HEADERS);
  var existing = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function(r){ existing[String(r[1]) + "|" + String(r[2])] = true; });
  }
  var pj = ss.getSheetByName("01_projects");
  var last = pj.getLastRow();
  if (last < 2) { Logger.log("01_projectsが空"); return 0; }
  var vals = pj.getRange(2, 1, last - 1, CH_PROJ_HEADERS.length).getValues();
  var now = new Date().toISOString();
  var docTypes = [["demolition_notice","解体届出"],["asbestos","石綿事前調査"],["manifest","マニフェスト"]];
  var rows = [];
  vals.forEach(function(p){
    var pid = String(p[0] || ""); if (!pid) return;
    var name = String(p[2] || ""); var kind = String(p[7] || "");
    if (kind.indexOf("解体") < 0 && name.indexOf("解体") < 0) return; // 解体系のみ法定3書類の対象
    docTypes.forEach(function(dt){
      if (existing[pid + "|" + dt[0]]) return;
      rows.push(["doc_" + Utilities.getUuid().slice(0,8), pid, dt[0], name + " " + dt[1], "", "", "要確認", "", "", "", "legal", "", "", 1, "TRUE", now, now, "2026-07-31 自動生成。要・不要は・法務が確認"]);
    });
  });
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, CH_DOC_HEADERS.length).setValues(rows);
  var ev = ss.getSheetByName("06_events");
  ev.appendRow(["ev_" + Utilities.getUuid().slice(0,8), now, "Claude", "", "05_documents", "generate", "", "", String(rows.length) + "行", "法定書類の期限管理を開始(解体系×解体届出・石綿・マニフェスト)", "caseHubAddDocs"]);
  Logger.log("05_documents: " + rows.length + "行追加\n" + ss.getUrl());
  return rows.length;
}
