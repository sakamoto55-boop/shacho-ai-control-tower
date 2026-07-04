/**
 * Phase 1向けの最小限の手入力ページ。
 * 「管理画面」ではなく、curlの代わりにテキストを貼って分析結果を見るだけの1枚ページ。
 * 保存済み一覧やナビゲーション、認証機能は持たない。
 */
export const consoleHtml = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>社長AI管制塔 - 手入力コンソール</title>
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif;
    max-width: 760px;
    margin: 0 auto;
    padding: 24px 16px 64px;
    line-height: 1.6;
  }
  h1 { font-size: 1.25rem; margin-bottom: 4px; }
  p.lead { color: #666; margin-top: 0; }
  fieldset { border: 1px solid #8883; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  label { display: block; font-size: 0.85rem; margin-bottom: 4px; margin-top: 10px; }
  textarea, input, select {
    width: 100%;
    box-sizing: border-box;
    padding: 8px;
    font-size: 0.95rem;
    border-radius: 6px;
    border: 1px solid #8886;
    background: transparent;
    color: inherit;
  }
  textarea { min-height: 120px; resize: vertical; }
  .row { display: flex; gap: 12px; }
  .row > div { flex: 1; }
  .buttons { display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap; }
  button {
    padding: 10px 16px;
    border-radius: 6px;
    border: 1px solid #8886;
    background: #1a73e8;
    color: white;
    font-size: 0.95rem;
    cursor: pointer;
  }
  button.secondary { background: transparent; color: inherit; }
  button:disabled { opacity: 0.6; cursor: not-allowed; }
  #result { margin-top: 24px; }
  .card { border: 1px solid #8883; border-radius: 8px; padding: 14px; margin-bottom: 12px; }
  .card h2 { font-size: 1rem; margin: 0 0 8px; }
  .badge {
    display: inline-block;
    font-size: 0.75rem;
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid #8886;
    margin-right: 6px;
  }
  .badge.A { background: #d93025; color: white; border-color: #d93025; }
  .badge.B { background: #f9ab00; color: black; border-color: #f9ab00; }
  .badge.C { background: #8886; }
  .badge.high { background: #d93025; color: white; border-color: #d93025; }
  .badge.medium { background: #f9ab00; color: black; border-color: #f9ab00; }
  .badge.low, .badge.none { background: #8886; }
  ul { padding-left: 18px; margin: 6px 0; }
  .error { color: #d93025; }
  .field-value { white-space: pre-wrap; }
</style>
</head>
<body>
  <h1>社長AI管制塔 - 手入力コンソール</h1>
  <p class="lead">
    Phase 1の手入力用ページです（保存済み一覧や管理機能はありません）。
    メール・LINE WORKS・その他の連絡内容を貼り付けて分析します。
  </p>

  <form id="analyze-form">
    <fieldset>
      <label for="text">本文（必須）</label>
      <textarea id="text" required placeholder="連絡内容を貼り付けてください"></textarea>

      <div class="row">
        <div>
          <label for="source">種別</label>
          <select id="source">
            <option value="manual_import">manual_import（手入力）</option>
            <option value="external_forward">external_forward（個人LINE等の転記）</option>
            <option value="lineworks">lineworks</option>
            <option value="gmail">gmail</option>
          </select>
        </div>
        <div>
          <label for="senderName">送信者名</label>
          <input id="senderName" type="text" placeholder="例：A社 田中様" />
        </div>
      </div>

      <div class="row">
        <div>
          <label for="roomName">ルーム名（任意）</label>
          <input id="roomName" type="text" placeholder="例：工務部ルーム" />
        </div>
        <div>
          <label for="subject">件名（任意）</label>
          <input id="subject" type="text" />
        </div>
      </div>

      <div class="buttons">
        <button type="submit" data-action="team-review">AI分析する（保存しない）</button>
        <button type="submit" data-action="analyze-and-save" class="secondary">AI分析して保存する</button>
      </div>
    </fieldset>
  </form>

  <div id="result"></div>

  <script>
    const form = document.getElementById('analyze-form');
    const resultEl = document.getElementById('result');

    function el(tag, props, children) {
      const node = document.createElement(tag);
      if (props) {
        for (const [key, value] of Object.entries(props)) {
          if (key === 'text') node.textContent = value;
          else node.setAttribute(key, value);
        }
      }
      (children || []).forEach((child) => node.appendChild(child));
      return node;
    }

    function badge(value, extraClass) {
      return el('span', { class: 'badge ' + (extraClass || value), text: value });
    }

    function renderError(message) {
      resultEl.innerHTML = '';
      resultEl.appendChild(el('div', { class: 'card error', text: message }));
    }

    function renderTasks(tasks) {
      const list = el('ul');
      tasks.forEach((task) => {
        const item = el('li', {
          text: task.taskTitle + '（担当:' + task.ownerType + ' / 期限:' + (task.dueDateText || 'なし') + '）'
        });
        list.appendChild(item);
        const detail = el('div', { text: '次アクション: ' + task.nextAction });
        detail.style.fontSize = '0.85rem';
        detail.style.color = '#666';
        list.appendChild(detail);
      });
      return list;
    }

    function renderTeamReviews(reviews) {
      const list = el('ul');
      reviews.filter((r) => r.relevant).forEach((r) => {
        const item = el('li', {}, [
          el('strong', { text: r.role + ': ' }),
          el('span', { text: r.recommendation }),
          r.requiresPresident ? badge('要社長確認') : el('span', { text: '' })
        ]);
        list.appendChild(item);
      });
      if (!reviews.some((r) => r.relevant)) {
        list.appendChild(el('li', { text: '担当外事項として記録のみ。' }));
      }
      return list;
    }

    function renderResult(data, saved) {
      resultEl.innerHTML = '';
      const result = data.result;

      const summaryCard = el('div', { class: 'card' }, [
        el('h2', { text: '分析結果' }),
        el('div', {}, [badge(result.priority), badge(result.risk.level)]),
        el('p', { class: 'field-value', text: result.summary }),
        el('p', { text: 'リスク: ' + result.risk.type + '（' + result.risk.reason + '）' }),
        el('p', { text: '返信要否: ' + (result.replyNeeded ? '必要' : '不要') })
      ]);
      resultEl.appendChild(summaryCard);

      if (result.tasks.length > 0) {
        resultEl.appendChild(el('div', { class: 'card' }, [
          el('h2', { text: 'タスク' }),
          renderTasks(result.tasks)
        ]));
      }

      if (result.replyDraft.needed) {
        const draftCard = el('div', { class: 'card' }, [
          el('h2', { text: '返信下書き（送信は人間が行ってください）' }),
          el('p', { class: 'field-value', text: result.replyDraft.text })
        ]);
        if (result.replyDraft.ngReasons.length > 0) {
          draftCard.appendChild(el('p', { class: 'error', text: '自動送信禁止: ' + result.replyDraft.ngReasons.join(' / ') }));
        }
        resultEl.appendChild(draftCard);
      }

      if (data.team) {
        resultEl.appendChild(el('div', { class: 'card' }, [
          el('h2', { text: '会社運営チームレビュー（リード担当: ' + data.team.leadRole + '）' }),
          renderTeamReviews(data.team.reviews)
        ]));
      }

      if (saved) {
        resultEl.appendChild(el('div', { class: 'card', text: '保存しました（Inbox ID: ' + data.inbox.id + '）' }));
      }
    }

    const accessKey = new URLSearchParams(window.location.search).get('key');

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const action = event.submitter ? event.submitter.dataset.action : 'team-review';
      const body = {
        text: document.getElementById('text').value,
        source: document.getElementById('source').value,
        senderName: document.getElementById('senderName').value,
        roomName: document.getElementById('roomName').value,
        subject: document.getElementById('subject').value
      };

      resultEl.innerHTML = '';
      resultEl.appendChild(el('p', { text: '分析中…' }));

      try {
        const endpoint = action === 'analyze-and-save' ? '/dev/analyze-and-save' : '/dev/team-review';
        const headers = { 'Content-Type': 'application/json' };
        if (accessKey) headers['x-console-key'] = accessKey;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok) {
          renderError(data.error || '分析に失敗しました。');
          return;
        }
        if (action === 'analyze-and-save') {
          renderResult({ result: {
            summary: data.inbox.summary,
            risk: { type: data.inbox.riskType, level: data.inbox.riskLevel, reason: '' },
            priority: data.inbox.priority,
            replyNeeded: data.inbox.replyNeeded,
            tasks: data.tasks,
            replyDraft: data.replyDraft || { needed: false, text: '', ngReasons: [] }
          }, inbox: data.inbox }, true);
        } else {
          renderResult(data, false);
        }
      } catch (error) {
        renderError('通信エラーが発生しました: ' + error.message);
      }
    });
  </script>
</body>
</html>`;
