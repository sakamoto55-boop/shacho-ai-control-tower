/**
 * GeminiClient.gs
 * Gemini API 呼び出し・JSON Schema 定義・レスポンス検証
 */

/**
 * メール情報を Gemini API に送り、AI 判定結果を返す
 * @param {Object} emailInfo extractEmailInfo() の戻り値
 * @param {string} apiKey Gemini API キー
 * @returns {Object} AI 判定結果
 */
function analyzeEmailWithGemini(emailInfo, apiKey) {
  const prompt = buildAnalysisPrompt(emailInfo);
  const schema = getEmailAnalysisSchema();

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema,
      temperature: 0.1,
      maxOutputTokens: 1500
    }
  };

  const url = `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const options = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true
  };

  let response;
  try {
    response = UrlFetchApp.fetch(url, options);
  } catch (e) {
    throw new Error(`Gemini API 通信エラー: ${e.message}`);
  }

  const statusCode = response.getResponseCode();
  if (statusCode !== 200) {
    // API キーをログに残さないよう、ステータスコードだけ記録
    throw new Error(`Gemini API エラー: HTTP ${statusCode}`);
  }

  return parseGeminiResponse(JSON.parse(response.getContentText()));
}

/**
 * AI 分析用のプロンプトを組み立てる
 * @param {Object} emailInfo
 * @returns {string}
 */
function buildAnalysisPrompt(emailInfo) {
  const receivedAt = Utilities.formatDate(emailInfo.date, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
  return `あなたは建設・工事・造園・外構関連の中小企業の事務担当AIアシスタントです。
以下のメールを分析し、事務担当者が対応すべきかを判断してください。

## メール情報
- 受信日時: ${receivedAt}
- 送信者: ${emailInfo.from}
- 件名: ${emailInfo.subject}
- 本文:
${emailInfo.bodyText}

## 判断基準

### 対応必要（requires_response=true）にするもの
- 見積依頼・現地調査依頼
- 顧客からの問い合わせ
- クレーム
- 日程調整
- 請求・入金・領収書・契約・注文書・発注書関係
- 協力会社からの確認
- 採用応募
- 行政・金融機関・士業・保険会社からの連絡
- 判断が曖昧だが人間確認が必要そうなもの

### 対応不要（requires_response=false）にするもの
- メルマガ・広告営業
- no-reply 通知・システム通知
- 単なる完了通知
- 明らかな迷惑メール
- 「返信不要」と明記された通知

### 優先度基準
- 高：クレーム、今日または翌営業日までに対応が必要、金額・請求・契約・入金関係、顧客や元請からの依頼、機会損失につながる見積依頼
- 中：通常の問い合わせ、日程調整、協力会社確認、採用応募
- 低：確認だけで済むもの、急ぎでないもの、判断が曖昧なもの

### 返信案のルール
- 日本語で丁寧かつ簡潔に書く
- 金額・工期・日程・契約条件を勝手に確定しない
- 不明点は「確認のうえご連絡いたします」とする
- クレームは謝意と確認姿勢を示すが、責任・補償を勝手に認めない
- 見積依頼は現地確認・担当確認・折り返し連絡の流れにする
- 請求・契約は担当確認後に返信する文面にする

迷った場合は requires_response=true、priority=低 にしてください。
指定の JSON スキーマに従って回答してください。`;
}

/**
 * Gemini API レスポンスの JSON スキーマを定義する
 * @returns {Object} Google AI API 形式のスキーマ
 */
function getEmailAnalysisSchema() {
  return {
    type: 'OBJECT',
    properties: {
      requires_response: {
        type: 'BOOLEAN',
        description: '事務担当者の対応が必要かどうか'
      },
      priority: {
        type: 'STRING',
        enum: ['高', '中', '低'],
        description: '対応優先度'
      },
      category: {
        type: 'STRING',
        enum: ['見積依頼', '顧客問い合わせ', 'クレーム', '日程調整', '請求経理',
               '協力会社', '採用', '行政金融', '営業広告', '通知', 'その他'],
        description: 'メールのカテゴリ'
      },
      summary: {
        type: 'STRING',
        description: '3行以内のメール要約'
      },
      task: {
        type: 'STRING',
        description: '事務員が次にやるべき具体的な対応内容'
      },
      reply_draft: {
        type: 'STRING',
        description: 'そのまま下書きに使える返信案（日本語、丁寧語）'
      },
      assignee_hint: {
        type: 'STRING',
        description: '担当候補（例：営業、工務、経理、総務、代表確認）'
      },
      due_hint: {
        type: 'STRING',
        description: '対応期限目安（例：今日中、翌営業日、今週中）'
      },
      risk_note: {
        type: 'STRING',
        description: '金額・契約・クレーム・個人情報などの注意点'
      },
      reason: {
        type: 'STRING',
        description: 'AI が対応要否・優先度を判断した理由'
      }
    },
    required: ['requires_response', 'priority', 'category', 'summary',
               'task', 'reply_draft', 'assignee_hint', 'due_hint', 'risk_note', 'reason']
  };
}

/**
 * Gemini API のレスポンスからテキストを取り出して JSON をパースする
 * @param {Object} responseJson
 * @returns {Object} 検証済み AI 判定結果
 */
function parseGeminiResponse(responseJson) {
  try {
    const text = responseJson.candidates[0].content.parts[0].text;
    const parsed = JSON.parse(text);
    return normalizeAiResult(parsed);
  } catch (e) {
    throw new Error(`Gemini レスポンスのパースに失敗: ${e.message}`);
  }
}

/**
 * AI 判定結果の型・値を正規化し、デフォルト値を補完する
 * @param {Object} raw パース直後のオブジェクト
 * @returns {Object}
 */
function normalizeAiResult(raw) {
  return {
    requires_response: typeof raw.requires_response === 'boolean' ? raw.requires_response : true,
    priority: PRIORITY_OPTIONS.includes(raw.priority) ? raw.priority : '低',
    category: CATEGORY_OPTIONS.includes(raw.category) ? raw.category : 'その他',
    summary: raw.summary || '（要約なし）',
    task: raw.task || '（対応タスクなし）',
    reply_draft: raw.reply_draft || '（返信案なし）',
    assignee_hint: raw.assignee_hint || '',
    due_hint: raw.due_hint || '',
    risk_note: raw.risk_note || '',
    reason: raw.reason || ''
  };
}

/**
 * ダミーメールで Gemini API の疎通テストを行う
 * @param {string} apiKey
 * @returns {Object} AI 判定結果
 */
function testGeminiWithDummyEmail(apiKey) {
  const dummyEmail = {
    messageId: 'test-dummy-id',
    threadId: 'test-dummy-thread',
    subject: '外構工事のお見積もりについて',
    from: '山田太郎 <yamada@example.com>',
    to: 'info@lcc55.com',
    date: new Date(),
    bodyText: `株式会社LCC55 御中

はじめてご連絡いたします。山田と申します。

弊社の駐車場拡張とフェンス設置の工事について、
お見積もりをお願いしたく存じます。

現場：東京都○○区××1-2-3
希望：現地確認後に御見積いただきたい

ご連絡をお待ちしております。
山田太郎 Tel: 090-0000-0000`,
    gmailLink: 'https://mail.google.com/mail/#dummy'
  };

  return analyzeEmailWithGemini(dummyEmail, apiKey);
}
