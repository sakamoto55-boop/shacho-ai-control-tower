/** 台帳の重複削除・一括クローズ・自動クローズ ★独立ファイル・既存コードには触れていません
 *
 * 背景（2026-09-25 社長指摘）:
 *  1. 台帳に同じ依頼が2行ある。2026-08-31 に受信箱画面から手で「登録」した8件が、
 *     既に自動昇格で入っていた行と重複した（コード.gs の registerIntakeItem に
 *     昇格済みチェックが無かったため。入口は同時に塞いだ）。
 *  2. 事務員が現物を用意して対応を終えているのに、台帳の行は「未作成」のまま残る。
 *     朝の通知は必要日から3日先までを出すが、必要日を過ぎた行は「期限超過」として
 *     毎朝ずっと出続けるので、放置すると永久に溜まる。
 *
 * ここでは3つを用意する。
 *  ・ledgerDedupeRun()        … 重複行を消す（1回きり）
 *  ・ledgerCloseUntilToday()  … 今日までの分を一括で受渡済みにする（1回きり）
 *  ・ledgerAutoCloseRun()     … 必要日を過ぎた行を毎日自動で受渡済みにする（常設トリガー）
 *
 * ★どれも Run の前に Preview があります。まず Preview を実行し、
 *   実行ログで対象を確かめてから Run を実行してください。
 */

var LC_CLOSED_STATUSES = ["受渡済み", "不要/保留"];
var LC_AUTO_CLOSE_DAYS_DEFAULT = 1; // 必要日の翌日以降を自動クローズ対象にする

// ============================== 共通 ==============================

/** 依頼文＋必要日が同じものを「同じ依頼」とみなす。空白差は無視する。 */
function lcDupKey_(manifest) {
  var text = String(manifest.lineworksText || "").replace(/\s+/g, "");
  var date = String(manifest.neededDate || "");
  if (!text) return ""; // 依頼文が無い行は突き合わせない（手入力分など）
  return text + "|" + date;
}

function lcIsClosed_(manifest) {
  return LC_CLOSED_STATUSES.indexOf(String(manifest.status)) >= 0;
}

/** 行の「実質の日付」。必要日が無い行は登録日で代用する（日付なしが永久に残らないように）。 */
function lcEffectiveDate_(manifest) {
  var needed = String(manifest.neededDate || "").trim();
  if (needed) return needed;
  return String(manifest.createdAt || "").slice(0, 10);
}

function lcFindDuplicateGroups_(manifests) {
  var byKey = {};
  manifests.forEach(function (manifest) {
    var key = lcDupKey_(manifest);
    if (!key) return;
    if (!byKey[key]) byKey[key] = [];
    byKey[key].push(manifest);
  });
  var groups = [];
  Object.keys(byKey).forEach(function (key) {
    var list = byKey[key];
    if (list.length < 2) return;
    // 先に登録された行を正とし、後から増えた行を消す
    list.sort(function (a, b) { return String(a.createdAt).localeCompare(String(b.createdAt)); });
    groups.push({ keep: list[0], remove: list.slice(1) });
  });
  return groups;
}

// ============================== 1. 重複削除 ==============================

/** ★試算：何が消えるかを実行ログに出すだけ。台帳は書き換えない。 */
function ledgerDedupePreview() {
  var groups = lcFindDuplicateGroups_(readManifests());
  var total = 0;
  groups.forEach(function (group) {
    total += group.remove.length;
    Logger.log("[" + group.keep.siteName + " / 必要日" + group.keep.neededDate + "]"
      + "\n    残す: " + group.keep.id + " (登録 " + String(group.keep.createdAt).slice(0, 10) + ")"
      + "\n    消す: " + group.remove.map(function (m) {
        return m.id + " (登録 " + String(m.createdAt).slice(0, 10) + ")";
      }).join(", "));
  });
  Logger.log("【試算】重複グループ " + groups.length + "件 / 削除予定 " + total + "行");
  return total;
}

/** 本実行：重複行を削除する。各グループで最も古い1行だけ残す。 */
function ledgerDedupeRun() {
  return withLock(function () {
    var manifests = readManifests();
    var groups = lcFindDuplicateGroups_(manifests);
    var removeIds = {};
    groups.forEach(function (group) {
      group.remove.forEach(function (manifest) { removeIds[manifest.id] = true; });
    });
    var next = manifests.filter(function (manifest) { return !removeIds[manifest.id]; });
    var removed = manifests.length - next.length;
    if (removed) writeManifests(next);
    Logger.log("ledgerDedupeRun: " + removed + "行を削除しました（残り " + next.length + "行）");
    return removed;
  });
}

// ============================== 2. 今日までを一括クローズ ==============================

/** ★試算：今日までの未完了が何件クローズされるかを実行ログに出すだけ。 */
function ledgerCloseUntilTodayPreview() {
  var today = todayJst();
  var targets = readManifests().filter(function (manifest) {
    return !lcIsClosed_(manifest) && lcEffectiveDate_(manifest) <= today;
  });
  targets.forEach(function (manifest) {
    Logger.log("  " + manifest.id + " " + lcEffectiveDate_(manifest) + " [" + manifest.status + "] "
      + manifest.siteName + " " + String(manifest.manifestBreakdown || ""));
  });
  Logger.log("【試算】今日(" + today + ")までの未完了 " + targets.length + "件を受渡済みにします");
  return targets.length;
}

/** 本実行：必要日が今日以前の未完了を「受渡済み」にする。
 *  注意: 今日必要の依頼も閉じるので、今朝の通知に出ていた分は消える。
 *  今日の分を現場に残したい場合は ledgerCloseUntilYesterday() を使う。 */
function ledgerCloseUntilToday() {
  return lcCloseOnOrBefore_(todayJst(), "一括クローズ", "今日までの分を一括で受渡済みに変更");
}

/** 本実行（安全側）：昨日以前だけ閉じる。今日必要の依頼は台帳に残す。 */
function ledgerCloseUntilYesterday() {
  var cutoff = addDays(todayJst(), -1);
  return lcCloseOnOrBefore_(cutoff, "一括クローズ", "昨日以前の滞留分を一括で受渡済みに変更");
}

// ============================== 3. 自動クローズ（常設） ==============================

/** 設定シートの LEDGER_AUTO_CLOSE_DAYS で猶予日数を変えられる。未設定なら1日。 */
function lcAutoCloseDays_() {
  var raw = "";
  try { raw = String((getConfig() || {}).LEDGER_AUTO_CLOSE_DAYS || "").trim(); } catch (error) { raw = ""; }
  var days = parseInt(raw, 10);
  return (isNaN(days) || days < 0) ? LC_AUTO_CLOSE_DAYS_DEFAULT : days;
}

/** ★試算：今日この自動クローズが動いたら何件閉じるかを実行ログに出すだけ。 */
function ledgerAutoClosePreview() {
  var cutoff = addDays(todayJst(), -lcAutoCloseDays_());
  var targets = readManifests().filter(function (manifest) {
    return !lcIsClosed_(manifest) && lcEffectiveDate_(manifest) <= cutoff;
  });
  targets.forEach(function (manifest) {
    Logger.log("  " + manifest.id + " " + lcEffectiveDate_(manifest) + " [" + manifest.status + "] "
      + manifest.siteName + " " + String(manifest.manifestBreakdown || ""));
  });
  Logger.log("【試算】" + cutoff + " 以前の未完了 " + targets.length + "件が自動クローズ対象です");
  return targets.length;
}

/** 毎日の自動クローズ本体（時間主導トリガーから呼ばれる）。 */
function ledgerAutoCloseRun() {
  var days = lcAutoCloseDays_();
  var cutoff = addDays(todayJst(), -days);
  return lcCloseOnOrBefore_(cutoff, "自動クローズ", "必要日から" + days + "日経過したため受渡済みに変更");
}

/** 毎朝6:30に自動クローズを動かす。7:30の通知より前に片付けておくため。 */
function ledgerAutoCloseInstallTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "ledgerAutoCloseRun") { Logger.log("既に設置済み"); return; }
  }
  ScriptApp.newTrigger("ledgerAutoCloseRun").timeBased().everyDays(1).atHour(6).nearMinute(30).create();
  Logger.log("毎朝6:30の自動クローズトリガーを設置しました");
}

function ledgerAutoCloseDisableTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === "ledgerAutoCloseRun") { ScriptApp.deleteTrigger(trigger); }
  });
  Logger.log("自動クローズトリガーを削除しました");
}

// ============================== クローズ処理の実体 ==============================

/** cutoff 以前の未完了を受渡済みにする。履歴に誰が何故閉じたかを残す。 */
function lcCloseOnOrBefore_(cutoff, by, summary) {
  return withLock(function () {
    var manifests = readManifests();
    var now = new Date().toISOString();
    var closed = 0;
    manifests.forEach(function (manifest) {
      if (lcIsClosed_(manifest)) return;
      if (lcEffectiveDate_(manifest) > cutoff) return;
      manifest.status = "受渡済み";
      manifest.handedOffAt = manifest.handedOffAt || now;
      manifest.updatedAt = now;
      manifest.history = [{ at: now, by: by, summary: summary }]
        .concat(manifest.history || []).slice(0, 30);
      closed++;
    });
    if (closed) writeManifests(manifests);
    Logger.log(by + ": " + cutoff + " 以前の " + closed + "件を受渡済みにしました");
    return closed;
  });
}

// ============================== 確認用 ==============================

/** 今の台帳の状態をログに出す。作業の前後で見比べる用。 */
function ledgerStats() {
  var manifests = readManifests();
  var byStatus = {};
  var bySource = {};
  var oldestOpen = "";
  manifests.forEach(function (manifest) {
    byStatus[manifest.status] = (byStatus[manifest.status] || 0) + 1;
    var source = String(manifest.requestSource || "(空)");
    bySource[source] = (bySource[source] || 0) + 1;
    if (!lcIsClosed_(manifest)) {
      var date = lcEffectiveDate_(manifest);
      if (date && (!oldestOpen || date < oldestOpen)) oldestOpen = date;
    }
  });
  var dupGroups = lcFindDuplicateGroups_(manifests).length;
  Logger.log("台帳 " + manifests.length + "行"
    + "\n  ステータス: " + JSON.stringify(byStatus)
    + "\n  取込元: " + JSON.stringify(bySource)
    + "\n  重複グループ: " + dupGroups + "件"
    + "\n  未完了の最古: " + (oldestOpen || "なし")
    + "\n  自動クローズ猶予: " + lcAutoCloseDays_() + "日");
}
