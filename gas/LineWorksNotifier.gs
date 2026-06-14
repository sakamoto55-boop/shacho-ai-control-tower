/**
 * LineWorksNotifier.gs
 * LINE WORKS Incoming Webhook への通知送信
 */

/**
 * タスク一覧を LINE WORKS に通知する
 * @param {string} webhookUrl LINE WORKS Webhook URL
 * @param {Object[]} tasks 通知するタスクの配列
 * @param {number} checkedCount 今回確認したメールの総件数
 * @param {boolean} isDryRun true の場合は実際には送信しない
 */
function sendLineWorksNotification(webhookUrl, tasks, checkedCount, isDryRun) {
  const message = buildNotificationMessage(tasks, checkedCount);

  if (isDryRun) {
    Logger.log('[DRY_RUN] LINE WORKS通知スキップ。内容:');
    Logger.log(message);
    return;
  }

  postToLineWorksWebhook(webhookUrl, message);
}

/**
 * 通知メッセージ本文を組み立てる
 * @param {Object[]} tasks タスク情報の配列
 * @param {number} checkedCount 確認した総メール件数
 * @returns {string} 通知本文
 */
function buildNotificationMessage(tasks, checkedCount) {
  if (tasks.length === 0) {
    return `【Infoメール確認】\n今回の確認では、対応が必要な新規メールはありません。\n確認件数：${checkedCount}件`;
  }

  const lines = [];
  lines.push(`【Infoメール対応】新規タスク ${tasks.length}件\n`);

  const displayTasks = tasks.slice(0, MAX_LINEWORKS_TASKS);

  for (const task of displayTasks) {
    const senderName = extractSenderDisplayName(task.sender);
    const draftLabel = getDraftLabel(task.draftId);

    lines.push(`[${task.priority}] ${senderName}／${task.subject}`);
    lines.push(`送信者：${task.sender}`);
    lines.push(`要約：${task.summary}`);
    lines.push(`対応：${task.task}`);
    if (task.assigneeHint) lines.push(`担当候補：${task.assigneeHint}`);
    if (task.dueHint) lines.push(`期限目安：${task.dueHint}`);
    lines.push(`下書き：${draftLabel}`);
    if (task.rowUrl) lines.push(`タスク：${task.rowUrl}`);
    lines.push('---');
  }

  if (tasks.length > MAX_LINEWORKS_TASKS) {
    const remaining = tasks.length - MAX_LINEWORKS_TASKS;
    lines.push(`他 ${remaining}件 はタスク表を確認してください`);
  }

  const message = lines.join('\n');

  // 長すぎる場合はトリム（LINE WORKS の上限に合わせる）
  if (message.length > MAX_NOTIFICATION_LENGTH) {
    return message.substring(0, MAX_NOTIFICATION_LENGTH - 30) + '\n\n（続きはタスク表を参照）';
  }

  return message;
}

/**
 * 送信者の表示名を「名前」または「ローカルパート」で返す
 * @param {string} from メールの From ヘッダ値
 * @returns {string}
 */
function extractSenderDisplayName(from) {
  // "山田太郎 <yamada@example.com>" 形式から名前を取得
  const nameMatch = from.match(/^([^<@]+?)\s*</);
  if (nameMatch) return nameMatch[1].trim();

  // "yamada@example.com" 形式からローカルパートを取得
  const localMatch = from.match(/^([^@]+)/);
  return localMatch ? localMatch[1] : from;
}

/**
 * 下書き ID から表示ラベルを返す
 * @param {string} draftId
 * @returns {string}
 */
function getDraftLabel(draftId) {
  if (!draftId) return '未作成';
  if (draftId === 'DRY_RUN_DRAFT') return 'DRY_RUN（テスト中）';
  if (draftId === 'DRAFT_ERROR') return '作成失敗';
  return '作成済み';
}

/**
 * LINE WORKS Incoming Webhook に POST する
 * @param {string} webhookUrl
 * @param {string} text 送信テキスト
 */
function postToLineWorksWebhook(webhookUrl, text) {
  const options = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    payload: JSON.stringify({ text }),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(webhookUrl, options);
  const statusCode = response.getResponseCode();

  if (statusCode < 200 || statusCode >= 300) {
    // Webhook URL をログに残さない
    throw new Error(`LINE WORKS Webhook エラー: HTTP ${statusCode}`);
  }

  Logger.log(`LINE WORKS 通知送信完了: HTTP ${statusCode}`);
}
