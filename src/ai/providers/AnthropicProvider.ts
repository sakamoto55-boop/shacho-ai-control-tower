import Anthropic from '@anthropic-ai/sdk';
import type { AnalyzeMessageInput, AnalyzeMessageResult } from '../../domain/types.js';
import type { AIProvider } from './AIProvider.js';

const SYSTEM_PROMPT = `あなたは建設会社の代表取締役（社長）を補佐するAIアシスタントです。

【最重要ルール：送信者の区別】
1. chatHistoryが提供される場合、senderType="president"の発言は「社長が送った言葉」です。
   これは背景情報として扱い、タスクや返信下書きの対象にしないでください。
2. senderType="other"の発言のみを、社長への連絡として分析してください。
3. 会話の最後の発言者が社長（president）の場合、相手への返信は不要と判断してください。
4. 会話の最後の発言者が相手（other）の場合、返信が必要かどうかを内容で判断してください。
5. chatHistoryがない場合は、textフィールドを相手からのメッセージとして処理してください。

【業種コンテキスト】
この会社は建設・解体・外構・不動産・福祉の5事業を展開しています。
以下の用語や状況は業務上重要です：
- 「現場」「配置」「職人」「資材」「工期」= 建設・外構・解体現場の話
- 「見積」「予算」「発注」= 受注・仕入れに関わる重要案件
- 「クレーム」「騒音」「近隣」= 即時対応が必要なリスク（優先度A）
- 「入居」「退去」「管理費」= 不動産管理の話
- 「利用者」「ケア」「施設」= 福祉事業の話
- 「至急」「事故」「ケガ」「現場が止まる」= 最優先（優先度A）

【優先度の判断基準】
A（即時対応）: クレーム、事故、現場停止、社長判断が必要な金額・契約、至急案件
B（本日中）: 見積依頼、確認事項、進捗報告で回答が必要なもの、日程調整
C（確認のみ・返信不要）: 完了報告、相槌（了解・ありがとう）、情報共有のみ

【禁止事項】
- 金額・値引き・外注費の自動確定
- 謝罪・責任認定の自動送信
- 契約・発注の自動確定
- 納期・工期の自動確定`;

function buildUserPrompt(input: AnalyzeMessageInput): string {
  const historySection =
    input.chatHistory && input.chatHistory.length > 0
      ? `\n\n【会話履歴（時系列順）】\n${input.chatHistory
          .map(
            (msg) =>
              `[${msg.senderType === 'president' ? '社長（自分）' : `相手: ${msg.senderName}`}] ${msg.text}`
          )
          .join('\n')}\n\n【最後の発言者】: ${
          input.chatHistory[input.chatHistory.length - 1].senderType === 'president'
            ? '社長（自分）→ 返信不要の可能性が高い'
            : `相手（${input.chatHistory[input.chatHistory.length - 1].senderName}）→ 返信要否を内容で判断`
        }`
      : '';

  return `以下のメッセージを分析してください。
${historySection}

【送信者名】: ${input.senderName}
【ルーム名】: ${input.roomName || '（個人チャット）'}
【件名】: ${input.subject || '（なし）'}
【メッセージ本文】:
${input.text}

以下のJSON形式で返答してください:
{
  "summary": "30文字以内の要約",
  "projectName": "案件名（不明なら空文字）",
  "customerName": "顧客名（不明なら空文字）",
  "priority": "A|B|C",
  "replyNeeded": true|false,
  "tasks": [
    {
      "taskTitle": "タスク名",
      "taskDetail": "詳細",
      "ownerType": "president|sales|construction|backoffice|partner|unknown",
      "ownerName": "担当者名（不明なら空文字）",
      "dueDate": "YYYY-MM-DDまたはnull",
      "dueDateText": "本日中・明日など人間が読みやすい形式",
      "priority": "A|B|C",
      "requiresPresident": true|false,
      "nextAction": "次にすべき具体的行動",
      "reason": "このタスクが必要な理由"
    }
  ],
  "replyDraft": {
    "needed": true|false,
    "text": "返信下書き（不要なら空文字）",
    "tone": "external_polite|internal_instruction|partner_request|apology_careful|confirmation_only",
    "confirmationNeeded": ["確認が必要な事項"],
    "ngReasons": ["自動送信してはいけない理由"]
  },
  "risk": {
    "type": "complaint|lost_order|gross_profit|payment_delay|site_stop|manpower_shortage|accident|contract|labor|none",
    "level": "high|medium|low|none",
    "reason": "リスク判断の理由"
  },
  "confidence": "high|medium|low"
}`;
}

export class AnthropicProvider implements AIProvider {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });
  }

  async analyzeMessage(input: AnalyzeMessageInput): Promise<AnalyzeMessageResult> {
    const response = await this.client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: buildUserPrompt(input)
        }
      ]
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Anthropic');
    }

    // JSONブロックを抽出
    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in Anthropic response');
    }

    return JSON.parse(jsonMatch[0]) as AnalyzeMessageResult;
  }
}
