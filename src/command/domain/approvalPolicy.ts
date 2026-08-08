/**
 * 承認ポリシー。Risk Level（LEVEL 0-5）ごとに実行可否を決める。
 * LEVEL 3（社内通知）はルール設定で自動化でき、LEVEL 4以上は必ず承認を経由する。
 * 設定は将来変更可能にするため、ポリシーオブジェクトとして注入する。
 */
import type { ActionRiskLevel } from './types.js';

export interface ApprovalPolicy {
  /** LEVEL 3（社内通知）を承認なしで許可するか */
  autoApproveInternalNotify: boolean;
}

export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = {
  autoApproveInternalNotify: false
};

export const RISK_LEVEL_LABELS: Record<ActionRiskLevel, string> = {
  0: '検索・閲覧',
  1: '社内要約・分析',
  2: '下書き作成',
  3: '社内通知',
  4: '外部送信・データ変更',
  5: '支払・契約・人事等'
};

export function requiresApproval(
  level: ActionRiskLevel,
  policy: ApprovalPolicy = DEFAULT_APPROVAL_POLICY
): boolean {
  if (level >= 4) return true;
  if (level === 3) return !policy.autoApproveInternalNotify;
  return false;
}
