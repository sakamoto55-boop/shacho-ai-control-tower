/**
 * Universal Conversation Router。
 * 質問を経営カテゴリへ多重分類し、固定Intent外の発話を
 * General Reasoning / Memory / Innovation へ振り分ける入口。
 * 社内事実の質問では必ずTool/Memory/Evidenceを優先する（一般知識で捏造しない）。
 */

export type ConversationCategory =
  | 'FACT_LOOKUP'
  | 'DATA_ANALYSIS'
  | 'MANAGEMENT_ADVICE'
  | 'DOCUMENT_ANALYSIS'
  | 'WRITING'
  | 'RESEARCH'
  | 'IDEATION'
  | 'PROBLEM_SOLVING'
  | 'DECISION_REVIEW'
  | 'MEMORY_RECALL'
  | 'ACTION_REQUEST'
  | 'GENERAL_CONVERSATION';

const RULES: Array<{ category: ConversationCategory; pattern: RegExp }> = [
  {
    category: 'MEMORY_RECALL',
    pattern: /前に|以前|昨日の話|この間|何だっけ|言ってた|決めたこと|覚えて/
  },
  { category: 'DECISION_REVIEW', pattern: /今も正しい|まだ有効|見直(す|し)|再検討/ },
  {
    category: 'FACT_LOOKUP',
    pattern: /いくら|何件|誰|どこ|いつ|状況|現場|売上|現金|請求|粗利|原価|見積/
  },
  { category: 'DATA_ANALYSIS', pattern: /なぜ|原因|理由|変じゃない|おかしくない|比較|分析|傾向/ },
  { category: 'MANAGEMENT_ADVICE', pattern: /どう思う|どうすれば|判断|大丈夫|べきか|相談/ },
  {
    category: 'DOCUMENT_ANALYSIS',
    pattern: /資料.{0,4}(読んで|要約|レビュー)|このメール|この文書/
  },
  { category: 'WRITING', pattern: /文章.{0,4}(作|書)|文面|下書き|連絡文|どう返す|作成して/ },
  { category: 'RESEARCH', pattern: /調べて|調査|制度|法律|法令|他社|他業界|業界動向|競合/ },
  { category: 'IDEATION', pattern: /アイデア|新しい事業|考えて|いいやり方|大胆|工夫|改善案/ },
  { category: 'PROBLEM_SOLVING', pattern: /根本原因|解決|対策|どう直す|なくすには/ },
  { category: 'ACTION_REQUEST', pattern: /送って|登録して|実行して|やって|作って/ }
];

export function classifyConversation(message: string): ConversationCategory[] {
  const categories = RULES.filter((rule) => rule.pattern.test(message)).map(
    (rule) => rule.category
  );
  if (categories.length === 0) return ['GENERAL_CONVERSATION'];
  return [...new Set(categories)];
}
