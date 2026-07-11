import type { InboxRecord, MessageSource, Priority, RiskType } from '../domain/types.js';
import type { Repository } from '../repositories/Repository.js';
import { todayIsoDate } from '../utils/date.js';

/**
 * LINE WORKS等に集まったメッセージを期間集約し、
 * 「問題になっているもの」をカテゴリ別にまとめてDX改善候補を提示するレポート。
 * デフォルトは直近30日のLINE WORKSが対象。
 */

export type ProblemDigestSource = MessageSource | 'all';

export interface ProblemDigestOptions {
  /** 集約対象のソース。デフォルトは lineworks。'all' で全ソース */
  source?: ProblemDigestSource;
  /** 遡る日数。デフォルト30日（1ヶ月） */
  days?: number;
  now?: Date;
}

export interface ProblemCategorySummary {
  riskType: RiskType;
  label: string;
  count: number;
  /** 代表例（要約）。最大3件 */
  examples: string[];
}

export interface RecurringSenderSummary {
  /** ルーム名（なければ送信者名） */
  name: string;
  count: number;
}

export interface DxCandidate {
  theme: string;
  /** 件数などの根拠 */
  evidence: string;
  suggestion: string;
}

export interface ProblemDigest {
  generatedAt: string;
  source: ProblemDigestSource;
  from: string;
  to: string;
  totalMessages: number;
  problemCount: number;
  countsByPriority: Record<Priority, number>;
  categories: ProblemCategorySummary[];
  recurringSenders: RecurringSenderSummary[];
  dxCandidates: DxCandidate[];
  text: string;
}

const riskTypeLabels: Record<RiskType, string> = {
  complaint: 'クレーム・顧客不満',
  lost_order: '失注・案件流出',
  gross_profit: '原価・粗利圧迫',
  payment_delay: '入金遅延・回収',
  site_stop: '現場停止・工程遅延',
  manpower_shortage: '人員不足・手配',
  accident: '事故・安全',
  contract: '契約関連',
  labor: '労務関連',
  none: 'その他（優先度A等）'
};

/** riskTypeごとのDX改善候補。繰り返し発生（2件以上）で提案に載せる */
const dxSuggestionsByRiskType: Partial<Record<RiskType, { theme: string; suggestion: string }>> = {
  complaint: {
    theme: 'クレーム対応の標準化',
    suggestion:
      '対応履歴を一元管理し、初動対応の手順とFAQを整備する。再発パターンを月次で振り返る仕組みを作る。'
  },
  payment_delay: {
    theme: '請求・入金管理のデジタル化',
    suggestion:
      '入金予定日の自動リマインドと未入金アラートを導入し、回収漏れを人の記憶に頼らない仕組みにする。'
  },
  site_stop: {
    theme: '工程・判断待ちの見える化',
    suggestion:
      '工程表をクラウド共有し、現場からの承認依頼（追加外注・変更）を即日判断できる承認フローを整備する。'
  },
  manpower_shortage: {
    theme: '人員・協力会社手配の見える化',
    suggestion:
      '職人・協力会社の稼働予定を一覧化し、応援依頼を定型フォーマット化して手配の属人化を減らす。'
  },
  gross_profit: {
    theme: '見積・原価データの連携',
    suggestion:
      '見積と実行原価をデータで突き合わせ、値引き・追加外注の承認基準を明文化する（LCC原価管理アプリの活用）。'
  },
  accident: {
    theme: '安全報告のデジタル化',
    suggestion: '事故・ヒヤリハット報告を定型化して蓄積し、現場別・原因別に再発防止策を共有する。'
  },
  contract: {
    theme: '契約書類の電子化',
    suggestion: '契約書・注文書のテンプレート整備と電子化で、契約条件の確認漏れを防ぐ。'
  },
  labor: {
    theme: '労務管理の仕組み化',
    suggestion: '勤怠・労務の記録をシステム化し、労務トラブルの火種を早期に把握する。'
  },
  lost_order: {
    theme: '失注理由の記録と分析',
    suggestion: '失注理由を記録して傾向を分析し、見積回答スピードや提案内容の改善につなげる。'
  }
};

/** 問題案件とみなす条件：優先度A、またはリスク検知あり */
export function isProblemRecord(record: InboxRecord): boolean {
  if (record.priority === 'A') return true;
  if (record.riskLevel === 'high' || record.riskLevel === 'medium') return true;
  if (record.riskType !== 'none') return true;
  return false;
}

function buildCategories(problems: InboxRecord[]): ProblemCategorySummary[] {
  const byType = new Map<RiskType, InboxRecord[]>();
  for (const record of problems) {
    const list = byType.get(record.riskType) ?? [];
    list.push(record);
    byType.set(record.riskType, list);
  }
  return [...byType.entries()]
    .map(([riskType, records]) => ({
      riskType,
      label: riskTypeLabels[riskType],
      count: records.length,
      examples: records.slice(0, 3).map((r) => r.summary || r.subject || r.originalText.slice(0, 40))
    }))
    .sort((a, b) => b.count - a.count);
}

function buildRecurringSenders(problems: InboxRecord[]): RecurringSenderSummary[] {
  const counts = new Map<string, number>();
  for (const record of problems) {
    const name = record.roomName || record.senderName || '不明';
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .filter((item) => item.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

function buildDxCandidates(
  categories: ProblemCategorySummary[],
  recurringSenders: RecurringSenderSummary[],
  replyNeededCount: number
): DxCandidate[] {
  const candidates: DxCandidate[] = [];

  for (const category of categories) {
    if (category.count < 2) continue;
    const suggestion = dxSuggestionsByRiskType[category.riskType];
    if (!suggestion) continue;
    candidates.push({
      theme: suggestion.theme,
      evidence: `${category.label}が期間内に${category.count}件発生`,
      suggestion: suggestion.suggestion
    });
  }

  if (replyNeededCount >= 3) {
    candidates.push({
      theme: '定型返信・FAQの整備',
      evidence: `返信が必要なメッセージが${replyNeededCount}件発生`,
      suggestion:
        'よくある問い合わせの返信テンプレートを整備し、担当者へ振り分けられる一次回答の型を作る。'
    });
  }

  const concentrated = recurringSenders.find((item) => item.count >= 3);
  if (concentrated) {
    candidates.push({
      theme: '問題が集中している窓口の業務フロー見直し',
      evidence: `「${concentrated.name}」で問題が${concentrated.count}件発生`,
      suggestion:
        '特定のルーム・相手に問題が集中している。報告フォーマットの統一や権限委譲で社長への集中を減らす。'
    });
  }

  return candidates;
}

function lineOrNone<T>(items: T[], formatter: (item: T, index: number) => string): string {
  if (items.length === 0) return 'なし';
  return items.map(formatter).join('\n');
}

function sourceLabel(source: ProblemDigestSource): string {
  return source === 'all' ? '全ソース' : source;
}

function buildText(digest: Omit<ProblemDigest, 'text'>, days: number): string {
  return [
    `【社長AI管制塔｜問題集約レポート（過去${days}日）】`,
    `対象: ${sourceLabel(digest.source)} / 期間: ${digest.from} 〜 ${digest.to}`,
    `受信メッセージ ${digest.totalMessages}件のうち、問題として検知 ${digest.problemCount}件`,
    `優先度内訳: A ${digest.countsByPriority.A}件 / B ${digest.countsByPriority.B}件 / C ${digest.countsByPriority.C}件`,
    '',
    '--- 問題カテゴリ別（多い順） ---',
    lineOrNone(digest.categories, (category, index) => {
      const examples = category.examples.map((example) => `   ・${example}`).join('\n');
      return `${index + 1}. ${category.label}: ${category.count}件\n${examples}`;
    }),
    '',
    '--- 問題が集中している相手・ルーム ---',
    lineOrNone(digest.recurringSenders, (item, index) => `${index + 1}. ${item.name}: ${item.count}件`),
    '',
    '--- DX改善候補（繰り返し発生している問題から） ---',
    lineOrNone(
      digest.dxCandidates,
      (candidate, index) =>
        `${index + 1}. ${candidate.theme}\n   根拠: ${candidate.evidence}\n   提案: ${candidate.suggestion}`
    ),
    ''
  ].join('\n');
}

export async function generateProblemDigest(
  repository: Repository,
  options: ProblemDigestOptions = {}
): Promise<ProblemDigest> {
  const source = options.source ?? 'lineworks';
  const days = options.days ?? 30;
  const now = options.now ?? new Date();

  const fromDate = new Date(now);
  fromDate.setDate(fromDate.getDate() - days);
  const from = fromDate.toISOString();
  const to = now.toISOString();

  const inbox = await repository.getInboxRecordsByDateRange({ from, to });
  const targets = source === 'all' ? inbox : inbox.filter((record) => record.source === source);
  const problems = targets.filter(isProblemRecord);

  const countsByPriority: Record<Priority, number> = { A: 0, B: 0, C: 0 };
  for (const record of problems) countsByPriority[record.priority] += 1;

  const replyNeededCount = problems.filter((record) => record.replyNeeded).length;
  const categories = buildCategories(problems);
  const recurringSenders = buildRecurringSenders(problems);
  const dxCandidates = buildDxCandidates(categories, recurringSenders, replyNeededCount);

  const base = {
    generatedAt: now.toISOString(),
    source,
    from: todayIsoDate(fromDate),
    to: todayIsoDate(now),
    totalMessages: targets.length,
    problemCount: problems.length,
    countsByPriority,
    categories,
    recurringSenders,
    dxCandidates
  };

  return { ...base, text: buildText(base, days) };
}
