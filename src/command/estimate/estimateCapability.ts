/**
 * Estimate Capability（Phase X §25-§26）。
 *
 * 「○○の見積作って」→ 顧客検索→類似案件→単価参照→草案→粗利計算→不足確認。
 * 金額はすべて決定論計算（過去実績の中央値等）。AIが暗算で金額を決めない。
 * 出力は「見積案」まで（正式見積の確定はユーザー）。
 */
import type { CommandDataset } from '../data/seed.js';
import type { Customer, Evidence, Project } from '../domain/types.js';
import { yen } from '../brief/generateBrief.js';

export interface EstimateDraft {
  customer: Customer | null;
  workKind: string | null;
  similarProjects: Project[];
  /** 過去同種案件の受注額（中央値・決定論） */
  referenceAmount: number | null;
  referenceMarginRate: number | null;
  missingInfo: string[];
  evidence: Evidence[];
  lines: string[];
}

const WORK_KINDS = ['解体', '外構', '伐採', '修繕', '残置物', '片付け', '剪定'];

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

export function draftEstimate(dataset: CommandDataset, message: string): EstimateDraft {
  const asOfDate = dataset.asOf.slice(0, 10);
  const customer =
    dataset.customers.find((c) => {
      const base = c.name.replace(/株式会社|（.+）/g, '');
      return base.length >= 2 && message.includes(base.slice(0, 3));
    }) ?? null;
  const workKind = WORK_KINDS.find((kind) => message.includes(kind)) ?? null;

  const similar = dataset.projects.filter((p) => {
    if (p.orderAmount <= 0) return false;
    if (workKind) return p.name.includes(workKind);
    if (customer) return p.customerId === customer.customerId;
    return false;
  });
  const amounts = similar.map((p) => p.orderAmount);
  const referenceAmount = median(amounts);
  const marginRates = similar.map((p) => p.plannedMarginRate).filter((r) => r > 0);
  const referenceMarginRate =
    marginRates.length > 0
      ? Math.round((marginRates.reduce((a, b) => a + b, 0) / marginRates.length) * 1000) / 1000
      : null;

  const missingInfo: string[] = [];
  if (!customer) missingInfo.push('顧客名（既存顧客か新規かの確認）');
  if (!workKind) missingInfo.push('工種（解体/外構/伐採/修繕など）');
  missingInfo.push('現場住所・構造・規模（面積/立米）', '処分費の見込み（現地確認要否）');

  const evidence: Evidence[] = [];
  if (referenceAmount !== null) {
    evidence.push({
      label: `類似${similar.length}件の受注額中央値`,
      value: yen(referenceAmount),
      source: '案件台帳（決定論集計）',
      asOf: asOfDate
    });
  }
  if (referenceMarginRate !== null) {
    evidence.push({
      label: '類似案件の計画粗利率平均',
      value: `${Math.round(referenceMarginRate * 100)}%`,
      source: '案件台帳',
      asOf: asOfDate
    });
  }

  const lines = [
    '【見積案（草案）】',
    customer ? `顧客: ${customer.name}` : '顧客: 未特定',
    workKind ? `工種: ${workKind}` : '工種: 未特定',
    referenceAmount !== null
      ? `参考金額: ${yen(referenceAmount)}（過去の類似${similar.length}件の中央値。現場条件で増減します）`
      : '参考金額: 類似案件の実績データが不足しているため提示できません（推測で金額を作りません）',
    referenceMarginRate !== null
      ? `参考粗利率: ${Math.round(referenceMarginRate * 100)}%（類似案件の計画平均）`
      : '',
    '',
    '【確定に必要な情報】',
    ...missingInfo.map((m) => `・${m}`),
    '',
    '※金額の確定は情報入力後の決定論計算で行います。この草案のまま提出しないでください。'
  ].filter((l) => l !== '');

  return { customer, workKind, similarProjects: similar.slice(0, 5), referenceAmount, referenceMarginRate, missingInfo, evidence, lines };
}
