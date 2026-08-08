/**
 * Innovation Engine — 「創意工夫」を明示的な処理として実装する。
 *
 * 問題定義 → 現状 → Root Cause候補 → 社内類似事例（Memory）→ 前提を疑う →
 * Conservative / Practical / Innovative の複数案（実現性・ROI観点・Risk・最小テスト付き）。
 * 事実（データ・Memory）とAIの分析・提案を分離して出力する。
 * ユーザーが簡潔さを求めた場合は要約のみ返す。
 */
import type { CompanyScope } from '../domain/types.js';
import type { CommandDataset } from '../data/seed.js';
import { computeProjectMargin } from '../engines/margin.js';
import { detectSalesLeaks } from '../engines/salesLeak.js';
import { COST_CATEGORY_LABELS } from '../domain/types.js';
import type { MemoryRecord } from './types.js';

export interface InnovationOption {
  label: 'Conservative' | 'Practical' | 'Innovative';
  title: string;
  detail: string;
  feasibility: string;
  roiView: string;
  risk: string;
  smallestTest: string;
}

export interface InnovationProposal {
  problemDefinition: string;
  currentState: string[];
  rootCauseCandidates: string[];
  pastInternalCases: string[];
  challengedAssumption: string;
  options: InnovationOption[];
}

/** データとMemoryから根拠を集め、構造化された改善提案を組み立てる */
export function buildInnovationProposal(
  dataset: CommandDataset,
  scope: CompanyScope,
  problem: string,
  relatedMemories: MemoryRecord[],
  concise: boolean
): InnovationProposal {
  const currentState: string[] = [];
  const rootCauseCandidates: string[] = [];

  // データからの現状把握（決定論エンジンの結果のみを事実として使う）
  const leaks = detectSalesLeaks(dataset, scope);
  if (/追客|フォロー|営業|受注/.test(problem) && leaks.length > 0) {
    currentState.push(`営業要対応が${leaks.length}件（最優先: ${leaks[0].title}）`);
    rootCauseCandidates.push('追客・対応がタスク化されず個人の記憶に依存している可能性');
  }
  if (/粗利|原価|利益|処分/.test(problem)) {
    const margins = dataset.projects
      .filter((p) => p.orderAmount > 0)
      .map((p) => computeProjectMargin(dataset, p))
      .filter((m) => m.forecastMarginRate !== null && m.varianceDrivers.length > 0);
    const driverCount = new Map<string, number>();
    for (const margin of margins) {
      for (const driver of margin.varianceDrivers) {
        driverCount.set(driver.category, (driverCount.get(driver.category) ?? 0) + 1);
      }
    }
    const top = [...driverCount.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) {
      const label = COST_CATEGORY_LABELS[top[0] as keyof typeof COST_CATEGORY_LABELS] ?? top[0];
      currentState.push(
        `原価超過案件${margins.length}件のうち${top[1]}件で${label}費が共通して超過`
      );
      rootCauseCandidates.push(
        `見積精度の個別問題ではなく、${label}単価の設定・見積基準の問題である可能性`
      );
    }
  }
  if (/配置|日報/.test(problem)) {
    currentState.push(
      `予定配置${dataset.assignments.length}件 / 実績日報${dataset.dailyReports.length}件が登録されている`
    );
    rootCauseCandidates.push('配置作成が毎日ゼロからの手作業になっている可能性');
  }
  if (currentState.length === 0)
    currentState.push('この問題に直接対応する社内データはまだ接続されていません');
  if (rootCauseCandidates.length === 0)
    rootCauseCandidates.push('データ不足のため根本原因は未特定（追加調査が必要）');

  const pastInternalCases = relatedMemories
    .filter((m) => ['PROBLEM', 'LESSON', 'EXPERIMENT', 'RESULT'].includes(m.type))
    .slice(0, 3)
    .map((m) => `[${m.type}] ${m.statement}（${m.validFrom}）`);

  // Challenge Assumptions: 「どう改善するか」の前に「そもそも必要か」
  const challengedAssumption = /配置/.test(problem)
    ? '前提を疑う: 人間が毎日ゼロから配置を作る必要があるか？（前日コピー＋差分編集、固定パターン化、自動下書き生成で「作る作業」自体を減らせないか）'
    : '前提を疑う: この作業・プロセス自体をなくす、または発生源を断つ選択肢はないか？';

  const options: InnovationOption[] = [
    {
      label: 'Conservative',
      title: '現行プロセスのまま運用ルールを強化する',
      detail: 'チェックリスト・締め時刻・担当明確化で漏れを減らす。仕組みは変えない。',
      feasibility: '高（今日から可能）',
      roiView: '効果は限定的だが投資ゼロ',
      risk: '個人依存が残り、再発しやすい',
      smallestTest: '1週間、1現場・1担当者だけでルール運用して漏れ件数を記録する'
    },
    {
      label: 'Practical',
      title: '既存データを使った自動検知・自動下書きを足す',
      detail:
        'LCC COMMANDの検知（漏れ・超過・停滞）を朝Briefへ集約し、対応の下書きまで自動生成する。',
      feasibility: '中（既存機能の設定拡張で対応可能）',
      roiView: '工数削減と機会損失防止の両取り',
      risk: '検知閾値の調整が必要。過検知で無視されるリスク',
      smallestTest: '対象を1カテゴリに絞り、2週間の検知精度（的中/過検知）を測る'
    },
    {
      label: 'Innovative',
      title: 'プロセス自体を削除・反転する',
      detail:
        '「人が作って確認する」を「AIが下書きし、人は例外だけ判断する」へ反転。定型部分は自動確定する。',
      feasibility: '低〜中（承認ルールと例外設計が必要）',
      roiView: '成功すれば作業時間を大幅圧縮',
      risk: '例外ケースの見落とし。導入初期の信頼低下',
      smallestTest:
        '過去1か月分のデータでAI下書きを作り、実際の結果と突き合わせて一致率を測る（実運用へ出さない）'
    }
  ];

  return {
    problemDefinition: problem,
    currentState,
    rootCauseCandidates,
    pastInternalCases,
    challengedAssumption,
    options: concise ? options.slice(0, 3) : options
  };
}

export function formatInnovationProposal(proposal: InnovationProposal, concise: boolean): string {
  if (concise) {
    return [
      `【問題】${proposal.problemDefinition}`,
      '【AIの提案（要約）】',
      ...proposal.options.map((o) => `・${o.label}: ${o.title}（最小テスト: ${o.smallestTest}）`),
      '※詳細が必要なら「詳しく」と言ってください。'
    ].join('\n');
  }
  return [
    `【問題定義】${proposal.problemDefinition}`,
    '',
    '【確認できた事実（現状）】',
    ...proposal.currentState.map((s) => `・${s}`),
    '',
    '【AIの分析: 根本原因の候補】',
    ...proposal.rootCauseCandidates.map((s) => `・${s}`),
    ...(proposal.pastInternalCases.length > 0
      ? ['', '【社内の類似事例（Memory）】', ...proposal.pastInternalCases.map((s) => `・${s}`)]
      : []),
    '',
    `【${proposal.challengedAssumption}】`,
    '',
    '【AIの提案】',
    ...proposal.options.flatMap((o) => [
      `■ ${o.label}: ${o.title}`,
      `  内容: ${o.detail}`,
      `  実現性: ${o.feasibility} / ROI観点: ${o.roiView}`,
      `  リスク: ${o.risk}`,
      `  最小テスト: ${o.smallestTest}`
    ]),
    '',
    '※提案はAIの分析であり、最終判断は経営者が行ってください。実験として登録すれば結果まで追跡します。'
  ].join('\n');
}
