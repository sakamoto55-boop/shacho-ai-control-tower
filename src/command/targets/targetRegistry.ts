/**
 * Target Registry（Phase B1.5 §11-§15）。
 *
 * 経営目標の正本。コードへの直書き・Memoryのみでの保持を禁止し、
 * CANDIDATE → （ユーザー承認）→ ACTIVE → SUPERSEDED/EXPIRED の履歴を保持する。
 *
 * - 発見された目標値（経営管理シート等）はCANDIDATEとしてのみ登録できる。
 * - ACTIVE化はユーザーの明示承認のみ（AIは独断でACTIVEにしない）。
 * - 数値評価はTarget Registryを参照し、Memory側には「目標変更を決定した」というDecisionを残す。
 */
import type { Principal } from '../domain/types.js';
import type { CommandRepository } from '../repositories/CommandRepository.js';
import { AccessDeniedError } from '../domain/rbac.js';

export type TargetMetric =
  | 'ANNUAL_SALES'
  | 'MONTHLY_SALES'
  | 'GROSS_PROFIT'
  | 'GROSS_MARGIN'
  | 'ORDERS'
  | 'PIPELINE'
  | 'CASH_MINIMUM'
  | 'COLLECTION'
  | 'BILLING'
  | 'SALES_ACTIVITY'
  | 'DEPARTMENT_KPI';

export type TargetStatus = 'CANDIDATE' | 'ACTIVE' | 'SUPERSEDED' | 'EXPIRED';
export type TargetPeriodType = 'FISCAL_YEAR' | 'MONTH' | 'QUARTER' | 'ROLLING';

export interface TargetRecord {
  targetId: string;
  companyId: string;
  /** 部門コード（全社目標は 'all'） */
  departmentId: string;
  metric: TargetMetric;
  periodType: TargetPeriodType;
  periodStart: string;
  periodEnd: string;
  value: number;
  unit: 'JPY' | 'PERCENT' | 'COUNT';
  status: TargetStatus;
  /** 出典（例: 経営管理第13期シート / 会話での指示） */
  source: string;
  approvedBy?: string;
  approvedAt?: string;
  validFrom: string;
  validUntil?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  /** SUPERSEDED時の後継Target */
  supersededBy?: string;
}

export type NewTargetInput = Omit<
  TargetRecord,
  'targetId' | 'status' | 'createdAt' | 'updatedAt' | 'approvedBy' | 'approvedAt' | 'supersededBy'
>;

let targetSeq = 0;
export function resetTargetSeq(): void {
  targetSeq = 0;
}
function newTargetId(now: string): string {
  targetSeq += 1;
  return `tgt-${now.slice(0, 10)}-${String(targetSeq).padStart(3, '0')}`;
}

export class TargetRegistryService {
  constructor(private readonly repository: CommandRepository) {}

  /** 発見・提案された目標はCANDIDATEとしてのみ登録できる（§13） */
  async registerCandidate(input: NewTargetInput, now: string): Promise<TargetRecord> {
    const record: TargetRecord = {
      ...input,
      targetId: newTargetId(now),
      status: 'CANDIDATE',
      createdAt: now,
      updatedAt: now
    };
    await this.repository.saveTarget(record);
    return record;
  }

  /**
   * ユーザー承認によるACTIVE化（§14）。PRESIDENT/EXECUTIVEのみ。
   * 同一metric×期間×部門の既存ACTIVEはSUPERSEDEDへ遷移し履歴を残す。
   */
  async approve(targetId: string, principal: Principal, now: string): Promise<TargetRecord> {
    if (principal.role !== 'PRESIDENT' && principal.role !== 'EXECUTIVE') {
      throw new AccessDeniedError(`ロール${principal.role}は経営目標を承認できません`);
    }
    const targets = await this.repository.getTargets();
    const target = targets.find((t) => t.targetId === targetId);
    if (!target) throw new Error(`Target ${targetId} が見つかりません`);
    if (target.status === 'ACTIVE') return target;

    for (const existing of targets) {
      if (
        existing.status === 'ACTIVE' &&
        existing.companyId === target.companyId &&
        existing.departmentId === target.departmentId &&
        existing.metric === target.metric &&
        existing.periodStart === target.periodStart &&
        existing.periodEnd === target.periodEnd
      ) {
        await this.repository.saveTarget({
          ...existing,
          status: 'SUPERSEDED',
          supersededBy: target.targetId,
          updatedAt: now
        });
      }
    }
    const approved: TargetRecord = {
      ...target,
      status: 'ACTIVE',
      approvedBy: principal.label,
      approvedAt: now,
      updatedAt: now
    };
    await this.repository.saveTarget(approved);
    return approved;
  }

  /** 有効なACTIVE目標（validUntil超過はEXPIRED扱いで返さない） */
  async activeTargets(asOf: string): Promise<TargetRecord[]> {
    const targets = await this.repository.getTargets();
    return targets.filter(
      (t) =>
        t.status === 'ACTIVE' &&
        t.validFrom <= asOf.slice(0, 10) &&
        (!t.validUntil || t.validUntil >= asOf.slice(0, 10))
    );
  }

  async list(): Promise<TargetRecord[]> {
    return this.repository.getTargets();
  }
}
