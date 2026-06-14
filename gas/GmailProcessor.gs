/**
 * GmailProcessor.gs
 * Gmail の検索・本文取得・重複チェック・下書き作成
 */

/**
 * 新着メールを検索して返す
 * @param {Object} config getConfig() の戻り値
 * @param {Set<string>} processedMessageIds 処理済みメッセージIDのセット
 * @param {number} lastSuccessMs 前回成功時刻（Unix時間ミリ秒）
 * @returns {GmailMessage[]} 処理対象のメッセージ一覧（古い順）
 */
function searchNewEmails(config, processedMessageIds, lastSuccessMs) {
  const query = buildGmailSearchQuery(config.targetEmail);
  Logger.log(`Gmail検索クエリ: ${query}`);

  const threads = GmailApp.search(query, 0, MAX_EMAILS_PER_RUN);
  Logger.log(`取得スレッド数: ${threads.length}`);

  // 初回実行は直近3日分。2回目以降は前回成功時刻以降
  const cutoffMs = lastSuccessMs > 0
    ? lastSuccessMs
    : Date.now() - INITIAL_RUN_DAYS * 24 * 60 * 60 * 1000;

  const newMessages = [];

  for (const thread of threads) {
    for (const msg of thread.getMessages()) {
      const msgDateMs = msg.getDate().getTime();
      if (msgDateMs > cutoffMs && !processedMessageIds.has(msg.getId())) {
        newMessages.push(msg);
      }
    }
  }

  // 受信日時の昇順（古いものから処理）
  newMessages.sort((a, b) => a.getDate().getTime() - b.getDate().getTime());

  Logger.log(`処理対象メール: ${newMessages.length}件`);
  return newMessages;
}

/**
 * Gmail 検索クエリを組み立てる
 * @param {string} targetEmail 対象メールアドレス
 * @returns {string} Gmail 検索クエリ
 */
function buildGmailSearchQuery(targetEmail) {
  return [
    `to:${targetEmail}`,
    `newer_than:${GMAIL_SEARCH_DAYS}d`,
    '-in:trash',
    '-in:spam',
    '-in:drafts',
    '-in:sent'
  ].join(' ');
}

/**
 * メールから AI 分析・スプレッドシート登録に必要な情報を抽出する
 * @param {GmailMessage} message
 * @returns {Object} メール情報オブジェクト
 */
function extractEmailInfo(message) {
  const bodyText = getEmailBodyText(message).substring(0, MAX_BODY_LENGTH);
  return {
    messageId: message.getId(),
    threadId: message.getThread().getId(),
    subject: message.getSubject() || '（件名なし）',
    from: message.getFrom(),
    to: message.getTo(),
    date: message.getDate(),
    bodyText: bodyText,
    gmailLink: `https://mail.google.com/mail/u/0/#inbox/${message.getId()}`
  };
}

/**
 * メール本文をプレーンテキストで取得する（HTML があれば変換）
 * @param {GmailMessage} message
 * @returns {string}
 */
function getEmailBodyText(message) {
  let body = message.getPlainBody();

  if (!body || body.trim().length === 0) {
    body = message.getBody()
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  return body || '（本文なし）';
}

/**
 * Gmail に返信下書きを作成する
 * @param {GmailMessage} message 返信元メッセージ
 * @param {string} replyBody 下書き本文
 * @param {boolean} isDryRun true の場合は作成しない
 * @returns {string} 下書きID または 'DRY_RUN_DRAFT'
 */
function createDraftReply(message, replyBody, isDryRun) {
  if (isDryRun) {
    Logger.log(`[DRY_RUN] 下書き作成スキップ: msgId=${message.getId()}`);
    return 'DRY_RUN_DRAFT';
  }

  try {
    const thread = message.getThread();
    const draft = thread.createDraftReplyAll(replyBody);
    Logger.log(`下書き作成完了: draftId=${draft.getId()}`);
    return draft.getId();
  } catch (e) {
    Logger.log(`下書き作成エラー: ${e.message}`);
    throw e;
  }
}
