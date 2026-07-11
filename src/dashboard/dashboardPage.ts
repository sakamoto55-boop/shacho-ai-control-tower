/**
 * 社長AI管制塔ダッシュボード（単一HTML・ビルド不要）。
 * GET /dashboard で配信され、/dashboard/summary を20秒間隔でポーリングして
 * 「今溜まっているもの」「行動決定」「確認事項」「改善候補」を可視化する。
 * 注意：このファイル内のJSはTSテンプレートリテラル内のため、バッククォートと${}を使わないこと。
 */
export const dashboardPage = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>社長AI管制塔ダッシュボード</title>
<style>
:root {
  --page: #f9f9f7;
  --surface: #fcfcfb;
  --ink: #0b0b0b;
  --ink-2: #52514e;
  --muted: #898781;
  --hairline: rgba(11, 11, 11, 0.10);
  --grid: #e1e0d9;
  --bar: #2a78d6;
  --critical: #d03b3b;
  --serious: #ec835a;
  --warning: #fab219;
  --good: #0ca30c;
  --critical-bg: rgba(208, 59, 59, 0.12);
  --serious-bg: rgba(236, 131, 90, 0.16);
  --warning-bg: rgba(250, 178, 25, 0.18);
  --muted-bg: rgba(137, 135, 129, 0.14);
}
@media (prefers-color-scheme: dark) {
  :root {
    --page: #0d0d0d;
    --surface: #1a1a19;
    --ink: #ffffff;
    --ink-2: #c3c2b7;
    --muted: #898781;
    --hairline: rgba(255, 255, 255, 0.10);
    --grid: #2c2c2a;
    --bar: #3987e5;
    --critical-bg: rgba(208, 59, 59, 0.25);
    --serious-bg: rgba(236, 131, 90, 0.22);
    --warning-bg: rgba(250, 178, 25, 0.20);
    --muted-bg: rgba(137, 135, 129, 0.22);
  }
}
* { box-sizing: border-box; margin: 0; }
body {
  background: var(--page);
  color: var(--ink);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  padding: 20px;
  max-width: 1200px;
  margin: 0 auto;
}
header { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
h1 { font-size: 18px; font-weight: 600; }
#updatedAt { font-size: 12px; color: var(--muted); }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 20px; }
.tile {
  background: var(--surface);
  border: 1px solid var(--hairline);
  border-radius: 10px;
  padding: 12px 14px;
}
.tile .label { font-size: 12px; color: var(--ink-2); }
.tile .value { font-size: 28px; font-weight: 600; margin-top: 2px; }
.tile.alert .value { color: var(--critical); }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 14px; }
section.card {
  background: var(--surface);
  border: 1px solid var(--hairline);
  border-radius: 10px;
  padding: 14px 16px;
}
section.card.wide { grid-column: 1 / -1; }
section.card h2 { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
section.card .sub { font-size: 12px; color: var(--muted); margin-bottom: 10px; }
ul.items { list-style: none; padding: 0; }
ul.items li { padding: 9px 0; border-top: 1px solid var(--grid); font-size: 13px; line-height: 1.5; }
ul.items li:first-child { border-top: none; }
.meta { font-size: 11px; color: var(--muted); margin-top: 2px; }
.none { color: var(--muted); font-size: 13px; padding: 8px 0; }
.badge {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  border-radius: 999px;
  padding: 1px 8px;
  margin-right: 6px;
  color: var(--ink);
  vertical-align: 1px;
}
.badge.a { background: var(--critical-bg); }
.badge.b { background: var(--warning-bg); }
.badge.c { background: var(--muted-bg); }
.badge.riskhigh { background: var(--critical-bg); }
.badge.riskmedium { background: var(--serious-bg); }
.badge.reply { background: var(--warning-bg); }
.badge.pres { background: var(--critical-bg); }
.barRow { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
.barRow .barLabel { flex: 0 0 140px; font-size: 12px; color: var(--ink-2); text-align: right; }
.barRow .barTrack { flex: 1; }
.barRow .barFill { height: 14px; background: var(--bar); border-radius: 0 4px 4px 0; min-width: 2px; }
.barRow .barValue { flex: 0 0 32px; font-size: 12px; color: var(--ink-2); }
.dx { border-top: 1px solid var(--grid); padding: 10px 0; }
.dx:first-of-type { border-top: none; }
.dx .theme { font-size: 13px; font-weight: 600; }
.dx .evidence { font-size: 12px; color: var(--muted); margin-top: 2px; }
.dx .suggestion { font-size: 13px; color: var(--ink-2); margin-top: 4px; line-height: 1.5; }
#error { color: var(--critical); font-size: 13px; margin-bottom: 10px; display: none; }
</style>
</head>
<body>
<header>
  <h1>社長AI管制塔ダッシュボード</h1>
  <span id="updatedAt">読み込み中…</span>
</header>
<div id="error"></div>
<div class="tiles" id="tiles"></div>
<div class="grid">
  <section class="card">
    <h2>行動決定（社長判断が必要）</h2>
    <div class="sub">優先度Aの受信・社長判断タスク・期限超過</div>
    <ul class="items" id="decisions"></ul>
  </section>
  <section class="card">
    <h2>確認すること</h2>
    <div class="sub">承認待ちの返信下書きと要返信メッセージ</div>
    <ul class="items" id="confirmations"></ul>
  </section>
  <section class="card">
    <h2>リアルタイム受信（最新）</h2>
    <div class="sub">全ソースの最新メッセージ</div>
    <ul class="items" id="realtime"></ul>
  </section>
  <section class="card wide">
    <h2>改善できること（過去30日）</h2>
    <div class="sub" id="improveSub"></div>
    <div id="categories"></div>
    <div id="dxCandidates"></div>
  </section>
</div>
<script>
(function () {
  'use strict';

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function badge(cls, label) {
    return '<span class="badge ' + cls + '">' + esc(label) + '</span>';
  }

  function priorityBadge(priority) {
    if (priority === 'A') return badge('a', 'A 社長判断');
    if (priority === 'B') return badge('b', 'B 担当振り分け');
    return badge('c', 'C 記録');
  }

  function riskBadge(level) {
    if (level === 'high') return badge('riskhigh', '高リスク');
    if (level === 'medium') return badge('riskmedium', '中リスク');
    return '';
  }

  function timeLabel(iso) {
    if (!iso) return '';
    var date = new Date(iso);
    if (isNaN(date.getTime())) return esc(iso);
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return date.getMonth() + 1 + '/' + date.getDate() + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function inboxLine(item) {
    var who = item.roomName || item.senderName || item.source;
    return '<li>' + priorityBadge(item.priority) + riskBadge(item.riskLevel) +
      (item.replyNeeded ? badge('reply', '要返信') : '') +
      esc(item.summary) +
      '<div class="meta">' + timeLabel(item.receivedAt) + '・' + esc(who) + '・' + esc(item.source) + '</div></li>';
  }

  function taskLine(item, overdue) {
    var owner = item.ownerName ? item.ownerType + ':' + item.ownerName : item.ownerType;
    return '<li>' + (overdue ? badge('riskhigh', '期限超過') : '') +
      (item.requiresPresident ? badge('pres', '社長判断') : '') +
      esc(item.taskTitle) +
      '<div class="meta">' + esc(owner) + '・期限:' + esc(item.dueDateText) +
      (item.projectName ? '・' + esc(item.projectName) : '') + '</div></li>';
  }

  function draftLine(item) {
    var confirms = item.confirmationNeeded && item.confirmationNeeded.length
      ? '<div class="meta">要確認: ' + esc(item.confirmationNeeded.join(' / ')) + '</div>'
      : '';
    return '<li>' + badge('reply', '返信下書き') + esc(item.recipientName || '宛先未特定') + ' 宛' +
      '<div class="meta">' + esc(item.draftText) + '</div>' + confirms + '</li>';
  }

  function fill(id, html) {
    document.getElementById(id).innerHTML = html || '<li class="none">なし</li>';
  }

  function tile(label, value, alert) {
    return '<div class="tile' + (alert && value > 0 ? ' alert' : '') + '">' +
      '<div class="label">' + esc(label) + '</div>' +
      '<div class="value">' + esc(value) + '</div></div>';
  }

  function render(data) {
    var tiles = data.tiles;
    document.getElementById('tiles').innerHTML =
      tile('社長判断が必要', tiles.presidentDecision, true) +
      tile('高リスク検知', tiles.highRisk, true) +
      tile('期限超過タスク', tiles.overdue, true) +
      tile('未確認の受信', tiles.unreviewed, false) +
      tile('返信下書き待ち', tiles.replyDraftWaiting, false) +
      tile('未完了タスク', tiles.openTasks, false) +
      tile('今日の受信', tiles.todayReceived, false);

    fill('decisions',
      data.decisions.inbox.map(inboxLine).join('') +
      data.decisions.overdueTasks.map(function (t) { return taskLine(t, true); }).join('') +
      data.decisions.tasks.map(function (t) { return taskLine(t, false); }).join(''));

    fill('confirmations',
      data.confirmations.replyDrafts.map(draftLine).join('') +
      data.confirmations.replyNeeded.map(inboxLine).join(''));

    fill('realtime', data.realtime.map(inboxLine).join(''));

    var improvements = data.improvements;
    document.getElementById('improveSub').textContent =
      improvements.from + ' 〜 ' + improvements.to + ' に問題として検知 ' + improvements.problemCount + '件';

    var max = 1;
    improvements.categories.forEach(function (c) { if (c.count > max) max = c.count; });
    document.getElementById('categories').innerHTML = improvements.categories.map(function (c) {
      var width = Math.max(2, Math.round((c.count / max) * 100));
      return '<div class="barRow"><div class="barLabel">' + esc(c.label) + '</div>' +
        '<div class="barTrack"><div class="barFill" style="width:' + width + '%"></div></div>' +
        '<div class="barValue">' + c.count + '件</div></div>';
    }).join('') || '<div class="none">問題の検知なし</div>';

    document.getElementById('dxCandidates').innerHTML = improvements.dxCandidates.map(function (d) {
      return '<div class="dx"><div class="theme">' + esc(d.theme) + '</div>' +
        '<div class="evidence">根拠: ' + esc(d.evidence) + '</div>' +
        '<div class="suggestion">' + esc(d.suggestion) + '</div></div>';
    }).join('') || '<div class="none">繰り返し発生している問題はまだありません</div>';

    document.getElementById('updatedAt').textContent = '最終更新 ' + timeLabel(data.generatedAt) + '（20秒ごとに自動更新）';
    document.getElementById('error').style.display = 'none';
  }

  function load() {
    fetch('/dashboard/summary')
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(render)
      .catch(function (err) {
        var el = document.getElementById('error');
        el.textContent = 'データ取得に失敗しました: ' + err.message;
        el.style.display = 'block';
      });
  }

  load();
  setInterval(load, 20000);
})();
</script>
</body>
</html>
`;
