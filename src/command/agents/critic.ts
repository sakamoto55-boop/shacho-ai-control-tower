/**
 * Critic / Evaluator（Phase N §9-§11）。
 *
 * 重大な判断では生成結果をそのまま最終回答にしない。
 * Criticは答えを勝手に変更せず、issues[]・severity・recommendationを返す。
 * 全質問では起動しない（起動条件は shouldRunCritic）。
 */
import type { CommandChatResponse } from '../domain/types.js';
import type { MemoryRecord } from '../memory/types.js';
import { similarity } from '../memory/store.js';
import type { InputAssessment } from './rolePlanner.js';

export interface CriticIssue {
  issue: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  recommendation: string;
}

export interface CriticResult {
  ran: boolean;
  issues: CriticIssue[];
}

/** Critic起動条件（§10）。単純要約・文章作成では原則省略 */
export function shouldRunCritic(
  message: string,
  assessment: InputAssessment,
  context: { conflictingMemories: boolean; multiAgent: boolean; lowConfidenceEvidence: boolean }
): boolean {
  if (/本当に|間違いない|反対意見|別の見方|大丈夫か/.test(message)) return true;
  if (assessment.risk === 'HIGH') return true; // 財務・法務・人事・戦略・大型投資
  if (context.conflictingMemories) return true;
  if (context.multiAgent) return true;
  if (context.lowConfidenceEvidence) return true;
  return false;
}

/**
 * 決定論的レビュー。§9の最低確認項目をルールで検査する。
 * （実LLM接続時はCRITIC RoleのProviderで深い検証を追加できるが、この基本検査は常に走る）
 */
export function reviewAnswer(
  draft: Pick<CommandChatResponse, 'text' | 'evidence' | 'confidence'>,
  activeDecisions: MemoryRecord[],
  proposalRiskMentioned = false
): CriticResult {
  const issues: CriticIssue[] = [];
  const numberCount = (draft.text.match(/[0-9][0-9,]{2,}(円|%|万円)/g) ?? []).length;

  // Evidenceは十分か
  if (numberCount > 0 && draft.evidence.length === 0) {
    issues.push({
      issue: '数値を含む回答に根拠（Evidence）が添付されていない',
      severity: 'HIGH',
      recommendation: '決定論エンジンの根拠を必ず添付するか、数値の断定を避ける'
    });
  }
  // 推測と事実の分離
  if (/可能性|と思われ|かもしれ/.test(draft.text) && !/【AIの(推測|分析|提案)】/.test(draft.text)) {
    issues.push({
      issue: '推測表現が【AIの推測/分析】として区分されていない',
      severity: 'MEDIUM',
      recommendation: '事実と推測をセクションで分離する'
    });
  }
  // 確信度の低い断定
  if (
    (draft.confidence === 'LOW' || draft.confidence === 'UNKNOWN') &&
    /です。|します。/.test(draft.text) &&
    numberCount > 0
  ) {
    issues.push({
      issue: '低確信度なのに数値を断定調で提示している',
      severity: 'MEDIUM',
      recommendation: 'データ鮮度・確信度の注記を明示する'
    });
  }
  // 過去Decisionとの矛盾（対象トークンの重なり＋否定形Decision）
  for (const decision of activeDecisions) {
    const keyTokens = decision.statement.match(/[一-龠ァ-ヶー]{3,}/g) ?? [];
    const overlaps = keyTokens.some((token) => draft.text.includes(token));
    const nearDuplicate = similarity(draft.text, decision.statement) >= 0.25;
    if ((overlaps || nearDuplicate) && /ない|やめ|中止|禁止/.test(decision.statement)) {
      issues.push({
        issue: `有効なDecision「${decision.statement}」と矛盾する可能性がある`,
        severity: 'HIGH',
        recommendation: 'Decisionを参照し、変更するなら正式な方針変更として扱う'
      });
    }
  }
  // リスク・別案の欠落（提案型回答のみ）
  if (/【推奨】|提案/.test(draft.text)) {
    if (!proposalRiskMentioned && !/リスク/.test(draft.text)) {
      issues.push({
        issue: '提案にリスクの言及がない（過小評価の恐れ）',
        severity: 'MEDIUM',
        recommendation: '主要リスクと発生時の影響を明示する'
      });
    }
    if (!/別案|代替|他の案|Conservative|Innovative/.test(draft.text)) {
      issues.push({
        issue: '有力な別案が提示されていない',
        severity: 'LOW',
        recommendation: '少なくとも1つの代替案と不採用理由を示す'
      });
    }
  }
  return { ran: true, issues };
}

/**
 * Critic v2（Phase B1 §8）: LLMによる追加検証のフック。
 * LLMは指摘を「追加」できるだけで、決定論検査（reviewAnswer）の指摘を
 * 削除・上書きすることはできない（最終安全判定は決定論側）。
 */
export type LlmCriticAdvisor = (
  draft: { text: string; confidence: CommandChatResponse['confidence'] },
  originalMessage: string
) => Promise<CriticIssue[]>;

export async function reviewAnswerWithAdvisor(
  draft: Pick<CommandChatResponse, 'text' | 'evidence' | 'confidence'>,
  activeDecisions: MemoryRecord[],
  advisor?: LlmCriticAdvisor,
  originalMessage = ''
): Promise<CriticResult> {
  const base = reviewAnswer(draft, activeDecisions, false);
  if (!advisor) return base;
  try {
    const extra = await advisor({ text: draft.text, confidence: draft.confidence }, originalMessage);
    return { ran: true, issues: [...base.issues, ...extra.slice(0, 5)] };
  } catch {
    // LLM検証の失敗時は決定論検査の結果のみ返す（検証自体は止めない）
    return base;
  }
}

/** Devil's Advocate: 賛成案に対する反対論点を構造的に生成する（§11） */
export function devilsAdvocate(topic: string, facts: string[]): string[] {
  const counters = [
    `前提への疑問: 「${topic.slice(0, 40)}」の前提となる需要・数値は検証済みか（希望的観測の可能性）`,
    '機会費用: 同じ資金・人員を既存事業の改善へ投じた場合と比較したか',
    '撤退条件: うまくいかなかった場合の撤退ライン・損失上限が定義されているか',
    '実行力: 現在の体制で新しい業務を回す余力があるか（現場・管理の負荷増）'
  ];
  if (facts.some((fact) => /粗利|低下|悪化/.test(fact))) {
    counters.push(
      '既存課題優先: 現在進行中の粗利悪化・未請求などの足元の問題を先に解決すべきではないか'
    );
  }
  return counters;
}
