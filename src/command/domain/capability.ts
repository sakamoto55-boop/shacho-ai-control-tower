/**
 * 実データ質問Capability Matrix（Phase B1.5 §16-§17）。
 *
 * 「現在のデータで何に完全回答できるか」を決定論的に評価する。
 * NOT_ANSWERABLEの質問に対して、それらしい回答を作らず
 * 「不足しているデータ」と「接続後にできること」を明示するための基盤。
 * 配置・銀行が未接続でもBeta全体は止めない（§32）— そのCapabilityだけを明示する。
 */
import type { CommandDataset } from '../data/seed.js';
import { DATA_GAPS } from './dataGaps.js';

export type CapabilityAnswerability = 'ANSWERABLE' | 'PARTIAL' | 'NOT_ANSWERABLE';

export interface CapabilityEntry {
  key: string;
  label: string;
  status: CapabilityAnswerability;
  /** 判定根拠（データ実測に基づく） */
  reason: string;
  /** 不足データ（関連するData Gap ID） */
  missingGaps: string[];
  /** 接続後に可能になること */
  afterConnection?: string;
}

export function assessCapabilities(dataset: CommandDataset): CapabilityEntry[] {
  const has = {
    customers: dataset.customers.length > 0,
    projects: dataset.projects.length > 0,
    estimates: dataset.estimates.length > 0,
    costs: dataset.costs.length > 0,
    invoices: dataset.invoices.length > 0,
    payments: dataset.payments.length > 0,
    assignments: dataset.assignments.length > 0,
    dailyReports: dataset.dailyReports.length > 0,
    cashAccounts: dataset.cashAccounts.length > 0
  };
  const amounts = dataset.projects.filter((p) => (p.orderAmount ?? 0) > 0).length;

  return [
    {
      key: 'customer_search',
      label: '顧客検索',
      status: has.customers ? 'ANSWERABLE' : 'NOT_ANSWERABLE',
      reason: has.customers ? '顧客データ接続済み' : '顧客Source未接続',
      missingGaps: []
    },
    {
      key: 'project_search',
      label: '案件検索',
      status: has.projects ? 'ANSWERABLE' : 'NOT_ANSWERABLE',
      reason: has.projects ? '案件データ接続済み' : '案件Source未接続',
      missingGaps: []
    },
    {
      key: 'margin_analysis',
      label: '粗利分析',
      status: has.projects && amounts > 0 ? 'PARTIAL' : 'NOT_ANSWERABLE',
      reason:
        amounts > 0
          ? '金額入力済み案件のみ有効（実測では多数の案件が金額0のまま）。実績人工原価は未接続'
          : '金額データなし',
      missingGaps: ['DG-001', 'DG-003'],
      afterConnection: '日報接続後は実績人工込みの案件別粗利が可能'
    },
    {
      key: 'today_assignments',
      label: '今日の配置',
      status: has.assignments ? 'ANSWERABLE' : 'NOT_ANSWERABLE',
      reason: has.assignments
        ? '配置データ接続済み'
        : '配置のデジタル正本が未稼働（実運用は物理ホワイトボード+写真）',
      missingGaps: ['DG-002'],
      afterConnection: 'デジタル配置板の本番運用開始後に回答可能'
    },
    {
      key: 'yesterday_workforce',
      label: '昨日の実績日報',
      status: has.dailyReports ? 'PARTIAL' : 'NOT_ANSWERABLE',
      reason: has.dailyReports
        ? '日報データあり（確定済み行のみ実績として扱う）'
        : '実績日報の確定運用が未完成（AI読み取りドラフトのみ存在）',
      missingGaps: ['DG-001'],
      afterConnection: '「日報データ（AI読み取り）」の確定行接続後に回答可能'
    },
    {
      key: 'cash_forecast',
      label: '資金繰り（30/60/90日予測）',
      status: has.cashAccounts ? 'PARTIAL' : 'NOT_ANSWERABLE',
      reason: '銀行残高が未接続のため完全な資金予測はできない',
      missingGaps: ['DG-004'],
      afterConnection: '銀行接続後は現在残高起点の30/60/90日予測が可能'
    },
    {
      key: 'receivables',
      label: '未入金・回収状況',
      status: has.invoices ? 'PARTIAL' : 'NOT_ANSWERABLE',
      reason: '請求発行側のデータのみ（入金実績の記録場所が未確認）',
      missingGaps: ['DG-006', 'DG-004'],
      afterConnection: '入金記録の接続後に期日超過未入金を実測可能'
    },
    {
      key: 'target_comparison',
      label: '目標比評価',
      status: 'PARTIAL',
      reason: '正式承認済みの経営目標がない（経営管理シートは仮値と明記）',
      missingGaps: ['DG-007'],
      afterConnection: 'Target Registry承認後は目標比の着地評価が可能'
    },
    {
      key: 'pnl',
      label: '月次損益・固定費',
      status: 'NOT_ANSWERABLE',
      reason: '会計システム未接続',
      missingGaps: ['DG-005'],
      afterConnection: '会計接続後に月次損益の回答が可能'
    }
  ];
}

/** NOT_ANSWERABLE/PARTIALの回答へ添える不足データ説明を作る（§17） */
export function missingDataNote(entry: CapabilityEntry): string[] {
  const lines = [`【${entry.label}に不足しているデータ】`];
  for (const gapId of entry.missingGaps) {
    const gap = DATA_GAPS.find((g) => g.gapId === gapId);
    if (gap) lines.push(`・${gap.description}（${gap.gapId}）`);
  }
  if (entry.afterConnection) lines.push(`接続後: ${entry.afterConnection}`);
  return lines;
}
