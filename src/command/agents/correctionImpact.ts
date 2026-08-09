/**
 * Correction Impact Engine（Phase N §14-§17）。
 *
 * ユーザー訂正でMemoryを直すだけで終わらせず、影響範囲を探索して報告する。
 * 数値は勝手に書き換えず、再計算・確認の候補を提示する。
 * 必要な場合のみAIからユーザーへ確認質問を行う（Active Clarification構造）。
 */
import type { CommandDataset } from '../data/seed.js';
import type { MemoryRecord } from '../memory/types.js';
import { similarity } from '../memory/store.js';

export interface Clarification {
  confirmed: string[];
  unknown: string[];
  whyItMatters: string;
  options: string[];
  recommendation: string;
  question: string;
}

export interface ImpactReport {
  affectedProjects: Array<{ projectId: string; name: string; stage: string }>;
  affectedEstimates: number;
  affectedMetrics: string[];
  affectedProcesses: string[];
  affectedMemories: string[];
  clarification?: Clarification;
}

export function analyzeCorrectionImpact(
  dataset: CommandDataset,
  corrected: MemoryRecord,
  newContent: string | null,
  allMemories: MemoryRecord[]
): ImpactReport {
  const report: ImpactReport = {
    affectedProjects: [],
    affectedEstimates: 0,
    affectedMetrics: [],
    affectedProcesses: [],
    affectedMemories: []
  };
  const text = `${corrected.statement} ${newContent ?? ''}`;

  // Entity起点の影響探索（既存Entity/Relation構造を利用。Graph DB不要）
  const customerIds = corrected.entities
    .filter((e) => e.entityType === 'Customer' && e.entityId)
    .map((e) => e.entityId as string);
  const vendorNames = corrected.entities
    .filter((e) => e.entityType === 'Vendor')
    .map((e) => e.name);
  const projectIds = corrected.entities
    .filter((e) => e.entityType === 'Project' && e.entityId)
    .map((e) => e.entityId as string);

  for (const project of dataset.projects) {
    const hit =
      projectIds.includes(project.projectId) ||
      (customerIds.includes(project.customerId) &&
        ['ordered', 'in_progress', 'estimating', 'following'].includes(project.stage)) ||
      vendorNames.some((name) => project.name.includes(name.slice(0, 2)));
    if (hit) {
      report.affectedProjects.push({
        projectId: project.projectId,
        name: project.name,
        stage: project.stage
      });
    }
  }
  const affectedProjectIds = new Set(report.affectedProjects.map((p) => p.projectId));
  report.affectedEstimates =
    dataset.estimates.filter(
      (estimate) => affectedProjectIds.has(estimate.projectId) || customerIds.length === 0
    ).length === 0
      ? 0
      : dataset.estimates.filter((estimate) => affectedProjectIds.has(estimate.projectId)).length;

  // 単価・費用系の訂正は粗利・見積プロセスへ波及する
  if (/単価|価格|金額|費|コスト/.test(text)) {
    report.affectedMetrics.push('予測粗利率', '見積原価基準');
    report.affectedProcesses.push(
      '進行中案件の原価再計算（候補）',
      '今後の見積テンプレート更新（候補）'
    );
  }
  if (/方針|方向|やめ|中止/.test(text)) {
    report.affectedProcesses.push('関連アラート・営業優先順位の再評価');
  }

  // 関連Memory（類似・同一Entity）
  report.affectedMemories = allMemories
    .filter(
      (m) =>
        m.memoryId !== corrected.memoryId &&
        m.status === 'ACTIVE' &&
        (similarity(m.statement, corrected.statement) >= 0.25 ||
          m.entities.some((e) => corrected.entities.some((ce) => ce.name === e.name)))
    )
    .slice(0, 5)
    .map((m) => m.statement);

  // AI→User確認質問: 単価変更等はスコープ（正式変更か案件限定か）で影響が大きく異なる
  if (/単価|価格|金額/.test(text) && (customerIds.length > 0 || vendorNames.length > 0)) {
    const target = corrected.entities[0]?.name ?? '対象先';
    report.clarification = {
      confirmed: [`${target}に関する条件が変わったという訂正を記録しました`],
      unknown: ['この変更が正式決定（今後すべてに適用）か、今回案件のみかが未確認です'],
      whyItMatters: `適用範囲により、影響する案件数と見積基準の更新要否が変わります（現在${report.affectedProjects.length}案件が候補）`,
      options: ['正式変更（今後すべてに適用）', '今回案件のみ', 'まだ交渉中'],
      recommendation: '正式変更なら見積基準の更新候補を作成します',
      question: `${target}の新しい条件は正式決定ですか、それとも今回案件のみですか？`
    };
  }
  return report;
}

export function formatImpactReport(report: ImpactReport): string[] {
  const lines: string[] = [];
  if (report.affectedProjects.length > 0 || report.affectedEstimates > 0) {
    lines.push(
      `この修正は、進行中${report.affectedProjects.filter((p) => ['ordered', 'in_progress'].includes(p.stage)).length}案件・見積${report.affectedEstimates}件に影響する可能性があります。`
    );
    for (const project of report.affectedProjects.slice(0, 3)) {
      lines.push(`・${project.name}（${project.stage}）`);
    }
  }
  if (report.affectedMetrics.length > 0) {
    lines.push(
      `影響しうる指標: ${report.affectedMetrics.join('、')}（数値は書き換えず、再計算候補として扱います）`
    );
  }
  if (report.affectedMemories.length > 0) {
    lines.push(`関連する記憶: ${report.affectedMemories.slice(0, 2).join(' / ')}`);
  }
  if (report.clarification) {
    lines.push(
      '',
      `【確認できたこと】${report.clarification.confirmed.join('、')}`,
      `【不明なこと】${report.clarification.unknown.join('、')}`,
      `【なぜ重要か】${report.clarification.whyItMatters}`,
      `【選択肢】${report.clarification.options.join(' / ')}`,
      `【推奨】${report.clarification.recommendation}`,
      `❓ ${report.clarification.question}`
    );
  }
  return lines;
}
