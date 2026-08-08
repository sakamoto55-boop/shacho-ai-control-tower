/**
 * LCC COMMAND Phase A 用デモデータセット。
 *
 * 既存正本（会計・銀行・CRM・原価管理）へ接続するまでの間、
 * このシードが「読み取り対象の正本」の代わりを務める。
 * 全レコードは基準日 asOf からの相対日付で生成されるため、
 * いつ起動しても営業漏れ検知・資金繰り予測・粗利分析が再現できる。
 *
 * 数値はマスタープロンプトの基本UX例に合わせている：
 * - 当月売上着地が目標比▲7.1%
 * - A案件の予測粗利が35%→24.8%へ低下（主因：外注費+80万円、処分費+42.4万円）
 * - 月末の外注支払集中により30日後現金残高が通常より低下
 */
import type {
  DatasetMeta,
  CashAccount,
  DailyReportEntry,
  ScheduleAssignment,
  CashPlanEntry,
  Company,
  CostEntry,
  Customer,
  Employee,
  Estimate,
  Interaction,
  Invoice,
  Payment,
  Project,
  SalesTarget,
  Vendor
} from '../domain/types.js';
import { jstMonth } from '../utils/jst.js';

export interface CommandDataset {
  asOf: string;
  /** データ由来（demo/production）とSource別状態。Demo Fixture隔離の判定に使う */
  meta: DatasetMeta;
  companies: Company[];
  customers: Customer[];
  employees: Employee[];
  vendors: Vendor[];
  projects: Project[];
  estimates: Estimate[];
  interactions: Interaction[];
  costs: CostEntry[];
  invoices: Invoice[];
  payments: Payment[];
  cashAccounts: CashAccount[];
  cashPlans: CashPlanEntry[];
  salesTargets: SalesTarget[];
  /** 予定配置（配置板）。実績ではない */
  assignments: ScheduleAssignment[];
  /** 実績日報。人工の根拠 */
  dailyReports: DailyReportEntry[];
}

/** asOf（ISO日時）から days 日ずらしたISO日付を返す */
export function shiftDate(asOf: string, days: number): string {
  const date = new Date(asOf);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function monthOf(asOf: string): string {
  // 月次目標の帰属もJST基準（売上サマリの月判定と揃える）
  return jstMonth(asOf);
}

export function buildSeedDataset(asOf: string): CommandDataset {
  const d = (days: number) => shiftDate(asOf, days);
  const fresh = (source: string, daysAgo = 0) => ({
    lastUpdatedAt: `${d(-daysAgo)}T07:42:00.000Z`,
    source,
    stale: daysAgo > 0
  });

  const companies: Company[] = [
    { companyId: 'lcc', name: '株式会社LCC', externalIds: { estimateSystem: 'ORG-001' } },
    { companyId: 'wel', name: 'LCC福祉サービス', externalIds: {} }
  ];

  const customers: Customer[] = [
    { customerId: 'cust-izumo', companyId: 'lcc', name: '出雲不動産株式会社' },
    { customerId: 'cust-matsue', companyId: 'lcc', name: '松江ハウジング' },
    { customerId: 'cust-hikawa', companyId: 'lcc', name: '斐川管理サービス' },
    { customerId: 'cust-yamada', companyId: 'lcc', name: '山田工務店' },
    { customerId: 'cust-ono', companyId: 'lcc', name: '大野建設' },
    { customerId: 'cust-sanin', companyId: 'lcc', name: '山陰開発' },
    { customerId: 'cust-taisha', companyId: 'lcc', name: '大社商事' },
    { customerId: 'cust-gotsu', companyId: 'lcc', name: '江津リビング' },
    { customerId: 'cust-city', companyId: 'wel', name: '出雲市（委託）' }
  ];

  const employees: Employee[] = [
    { employeeId: 'emp-fujii', companyId: 'lcc', name: '藤井', role: '営業' },
    { employeeId: 'emp-tanaka', companyId: 'lcc', name: '田中', role: '工事' },
    { employeeId: 'emp-sato', companyId: 'wel', name: '佐藤', role: 'サービス管理' }
  ];

  const vendors: Vendor[] = [
    { vendorId: 'ven-kaitai', companyId: 'lcc', name: '協力会社（解体）', category: '外注' },
    { vendorId: 'ven-shobun', companyId: 'lcc', name: '処分場', category: '処分' }
  ];

  const projects: Project[] = [
    // A案件: 施工中。予定粗利35%に対し原価超過で予測粗利24.8%へ低下
    {
      projectId: 'prj-a',
      companyId: 'lcc',
      customerId: 'cust-izumo',
      name: 'A案件（出雲市 旧社屋解体工事）',
      stage: 'in_progress',
      orderAmount: 12_000_000,
      plannedMarginRate: 0.35,
      startDate: d(-20),
      dueDate: d(37),
      ownerEmployeeId: 'emp-tanaka',
      updatedAt: `${d(-1)}T18:10:00.000Z`
    },
    // B案件: 完工済みだが未請求（完工未請求の検知対象）
    {
      projectId: 'prj-b',
      companyId: 'lcc',
      customerId: 'cust-matsue',
      name: 'B案件（松江市 外構工事）',
      stage: 'completed',
      orderAmount: 6_000_000,
      plannedMarginRate: 0.3,
      startDate: d(-40),
      completedDate: d(-10),
      ownerEmployeeId: 'emp-tanaka',
      updatedAt: `${d(-10)}T18:10:00.000Z`
    },
    // C案件: 施工中。当月完工予定（売上着地予測に寄与）
    {
      projectId: 'prj-c',
      companyId: 'lcc',
      customerId: 'cust-hikawa',
      name: 'C案件（斐川 アパート改修）',
      stage: 'in_progress',
      orderAmount: 5_225_000,
      plannedMarginRate: 0.3,
      startDate: d(-15),
      dueDate: d(15),
      ownerEmployeeId: 'emp-tanaka',
      updatedAt: `${d(-1)}T18:10:00.000Z`
    },
    // D案件: 当月完工・請求済（確定売上）
    {
      projectId: 'prj-d',
      companyId: 'lcc',
      customerId: 'cust-ono',
      name: 'D案件（出雲市 造成工事）',
      stage: 'invoiced',
      orderAmount: 10_000_000,
      plannedMarginRate: 0.28,
      completedDate: d(-5),
      updatedAt: `${d(-4)}T18:10:00.000Z`
    },
    // E案件: 当月完工・入金済（確定売上）
    {
      projectId: 'prj-e',
      companyId: 'lcc',
      customerId: 'cust-sanin',
      name: 'E案件（松江市 小規模解体）',
      stage: 'paid',
      orderAmount: 8_000_000,
      plannedMarginRate: 0.32,
      completedDate: d(-6),
      updatedAt: `${d(-2)}T18:10:00.000Z`
    },
    // 営業漏れ検知用: 問い合わせ24時間未対応
    {
      projectId: 'prj-inq',
      companyId: 'lcc',
      customerId: 'cust-taisha',
      name: '大社商事 倉庫解体（問い合わせ）',
      stage: 'inquiry',
      orderAmount: 0,
      plannedMarginRate: 0,
      updatedAt: `${d(-2)}T09:00:00.000Z`
    },
    // 営業漏れ検知用: 現調後見積未提出
    {
      projectId: 'prj-est',
      companyId: 'lcc',
      customerId: 'cust-gotsu',
      name: '江津リビング 空き家解体（見積作成中）',
      stage: 'estimating',
      orderAmount: 0,
      plannedMarginRate: 0,
      updatedAt: `${d(-8)}T09:00:00.000Z`
    },
    // 営業漏れ検知用: 見積提出後追客なし（今月受注可能性が高い案件でもある）
    {
      projectId: 'prj-f1',
      companyId: 'lcc',
      customerId: 'cust-yamada',
      name: '山田工務店 母屋解体',
      stage: 'following',
      orderAmount: 0,
      plannedMarginRate: 0,
      updatedAt: `${d(-9)}T09:00:00.000Z`
    },
    {
      projectId: 'prj-f2',
      companyId: 'lcc',
      customerId: 'cust-izumo',
      name: '出雲不動産 駐車場外構',
      stage: 'following',
      orderAmount: 0,
      plannedMarginRate: 0,
      updatedAt: `${d(-3)}T09:00:00.000Z`
    },
    {
      projectId: 'prj-f3',
      companyId: 'lcc',
      customerId: 'cust-matsue',
      name: '松江ハウジング ブロック塀改修',
      stage: 'following',
      orderAmount: 0,
      plannedMarginRate: 0,
      updatedAt: `${d(-2)}T09:00:00.000Z`
    },
    {
      projectId: 'prj-f4',
      companyId: 'lcc',
      customerId: 'cust-ono',
      name: '大野建設 資材置場造成',
      stage: 'following',
      orderAmount: 0,
      plannedMarginRate: 0,
      updatedAt: `${d(-4)}T09:00:00.000Z`
    },
    {
      projectId: 'prj-f5',
      companyId: 'lcc',
      customerId: 'cust-sanin',
      name: '山陰開発 旧工場解体',
      stage: 'following',
      orderAmount: 0,
      plannedMarginRate: 0,
      updatedAt: `${d(-6)}T09:00:00.000Z`
    },
    // 営業漏れ検知用: 30日以上停滞
    {
      projectId: 'prj-stall',
      companyId: 'lcc',
      customerId: 'cust-yamada',
      name: '山田工務店 納屋解体（停滞）',
      stage: 'following',
      orderAmount: 0,
      plannedMarginRate: 0,
      updatedAt: `${d(-40)}T09:00:00.000Z`
    },
    // 営業漏れ検知用: 受注後次工程未設定
    {
      projectId: 'prj-ord',
      companyId: 'lcc',
      customerId: 'cust-hikawa',
      name: '斐川管理 フェンス設置（受注済）',
      stage: 'ordered',
      orderAmount: 1_800_000,
      plannedMarginRate: 0.3,
      updatedAt: `${d(-5)}T09:00:00.000Z`
    },
    // 先月完工・精算済み（金額不一致チェックの対象請求が紐づく）
    {
      projectId: 'prj-old',
      companyId: 'lcc',
      customerId: 'cust-matsue',
      name: '旧案件（松江市 塀撤去）',
      stage: 'paid',
      orderAmount: 2_200_000,
      plannedMarginRate: 0.3,
      completedDate: d(-60),
      updatedAt: `${d(-30)}T18:10:00.000Z`
    },
    // 福祉法人側の案件（法人分離の確認用）
    {
      projectId: 'prj-wel-1',
      companyId: 'wel',
      customerId: 'cust-city',
      name: 'B型事業所 受託作業（当月）',
      stage: 'in_progress',
      orderAmount: 1_650_000,
      plannedMarginRate: 0.15,
      dueDate: d(20),
      updatedAt: `${d(-1)}T18:10:00.000Z`
    }
  ];

  const estimates: Estimate[] = [
    {
      estimateId: 'est-f1',
      companyId: 'lcc',
      projectId: 'prj-f1',
      amount: 3_200_000,
      submittedAt: d(-9),
      probability: 0.7,
      status: 'submitted'
    },
    {
      estimateId: 'est-f2',
      companyId: 'lcc',
      projectId: 'prj-f2',
      amount: 2_400_000,
      submittedAt: d(-3),
      probability: 0.6,
      status: 'submitted'
    },
    {
      estimateId: 'est-f3',
      companyId: 'lcc',
      projectId: 'prj-f3',
      amount: 1_500_000,
      submittedAt: d(-2),
      probability: 0.6,
      status: 'submitted'
    },
    {
      estimateId: 'est-f4',
      companyId: 'lcc',
      projectId: 'prj-f4',
      amount: 1_200_000,
      submittedAt: d(-4),
      probability: 0.5,
      status: 'submitted'
    },
    {
      estimateId: 'est-f5',
      companyId: 'lcc',
      projectId: 'prj-f5',
      amount: 1_500_000,
      submittedAt: d(-6),
      probability: 0.5,
      status: 'submitted'
    },
    {
      estimateId: 'est-stall',
      companyId: 'lcc',
      projectId: 'prj-stall',
      amount: 900_000,
      submittedAt: d(-45),
      probability: 0.2,
      status: 'submitted'
    }
  ];

  const interactions: Interaction[] = [
    // 問い合わせ（prj-inq）: 2日前に受信したまま未対応
    {
      interactionId: 'int-inq',
      companyId: 'lcc',
      customerId: 'cust-taisha',
      projectId: 'prj-inq',
      channel: 'gmail',
      datetime: `${d(-2)}T09:00:00.000Z`,
      summary: '倉庫解体の見積依頼を受信'
    },
    // 見積提出後の追客なし（prj-f1）: 9日前の提出連絡が最後
    {
      interactionId: 'int-f1',
      companyId: 'lcc',
      customerId: 'cust-yamada',
      projectId: 'prj-f1',
      employeeId: 'emp-fujii',
      channel: 'gmail',
      datetime: `${d(-9)}T10:00:00.000Z`,
      summary: '見積書を送付'
    },
    {
      interactionId: 'int-f2',
      companyId: 'lcc',
      customerId: 'cust-izumo',
      projectId: 'prj-f2',
      employeeId: 'emp-fujii',
      channel: 'phone',
      datetime: `${d(-1)}T13:00:00.000Z`,
      summary: '見積内容の質問に回答。来週返事予定',
      nextAction: '受注可否の確認電話',
      nextActionDate: d(6)
    },
    // 山田工務店の最終接点（Gmail: 66日前 / 案件記録: 82日前）
    // 電話・一部チャットは構造化されていないため、最終接点は断定できない
    {
      interactionId: 'int-yamada-mail',
      companyId: 'lcc',
      customerId: 'cust-yamada',
      channel: 'gmail',
      datetime: `${d(-66)}T11:00:00.000Z`,
      summary: '納屋解体の相談メール'
    },
    {
      interactionId: 'int-yamada-note',
      companyId: 'lcc',
      customerId: 'cust-yamada',
      projectId: 'prj-stall',
      channel: 'manual',
      datetime: `${d(-82)}T15:00:00.000Z`,
      summary: '現地確認の記録'
    }
  ];

  // A案件の原価: 予定合計780万円（粗利35%）に対し、
  // 発生済み＋予測で902.4万円（粗利24.8%）。主因は外注+80万円、処分+42.4万円。
  const costs: CostEntry[] = [
    {
      costId: 'c-a-p1',
      companyId: 'lcc',
      projectId: 'prj-a',
      category: 'labor',
      amount: 2_000_000,
      date: d(-20),
      kind: 'planned'
    },
    {
      costId: 'c-a-p2',
      companyId: 'lcc',
      projectId: 'prj-a',
      category: 'subcontract',
      amount: 3_500_000,
      date: d(-20),
      kind: 'planned'
    },
    {
      costId: 'c-a-p3',
      companyId: 'lcc',
      projectId: 'prj-a',
      category: 'disposal',
      amount: 1_200_000,
      date: d(-20),
      kind: 'planned'
    },
    {
      costId: 'c-a-p4',
      companyId: 'lcc',
      projectId: 'prj-a',
      category: 'material',
      amount: 500_000,
      date: d(-20),
      kind: 'planned'
    },
    {
      costId: 'c-a-p5',
      companyId: 'lcc',
      projectId: 'prj-a',
      category: 'vehicle',
      amount: 300_000,
      date: d(-20),
      kind: 'planned'
    },
    {
      costId: 'c-a-p6',
      companyId: 'lcc',
      projectId: 'prj-a',
      category: 'machine',
      amount: 200_000,
      date: d(-20),
      kind: 'planned'
    },
    {
      costId: 'c-a-p7',
      companyId: 'lcc',
      projectId: 'prj-a',
      category: 'transport',
      amount: 100_000,
      date: d(-20),
      kind: 'planned'
    },
    {
      costId: 'c-a-a1',
      companyId: 'lcc',
      projectId: 'prj-a',
      category: 'labor',
      amount: 2_000_000,
      date: d(-3),
      kind: 'actual'
    },
    {
      costId: 'c-a-a2',
      companyId: 'lcc',
      projectId: 'prj-a',
      category: 'subcontract',
      amount: 3_000_000,
      date: d(-3),
      kind: 'actual',
      note: '追加作業分を含む'
    },
    {
      costId: 'c-a-f2',
      companyId: 'lcc',
      projectId: 'prj-a',
      category: 'subcontract',
      amount: 1_300_000,
      date: d(5),
      kind: 'forecast'
    },
    {
      costId: 'c-a-a3',
      companyId: 'lcc',
      projectId: 'prj-a',
      category: 'disposal',
      amount: 1_624_000,
      date: d(-2),
      kind: 'actual',
      note: '搬出量が想定超過'
    },
    {
      costId: 'c-a-f4',
      companyId: 'lcc',
      projectId: 'prj-a',
      category: 'material',
      amount: 500_000,
      date: d(3),
      kind: 'forecast'
    },
    {
      costId: 'c-a-f5',
      companyId: 'lcc',
      projectId: 'prj-a',
      category: 'vehicle',
      amount: 300_000,
      date: d(3),
      kind: 'forecast'
    },
    {
      costId: 'c-a-f6',
      companyId: 'lcc',
      projectId: 'prj-a',
      category: 'machine',
      amount: 200_000,
      date: d(3),
      kind: 'forecast'
    },
    {
      costId: 'c-a-f7',
      companyId: 'lcc',
      projectId: 'prj-a',
      category: 'transport',
      amount: 100_000,
      date: d(3),
      kind: 'forecast'
    },
    // B案件（完工済み）: 実績原価420万円 → 実績粗利30%
    {
      costId: 'c-b-p1',
      companyId: 'lcc',
      projectId: 'prj-b',
      category: 'labor',
      amount: 1_800_000,
      date: d(-40),
      kind: 'planned'
    },
    {
      costId: 'c-b-p2',
      companyId: 'lcc',
      projectId: 'prj-b',
      category: 'material',
      amount: 2_400_000,
      date: d(-40),
      kind: 'planned'
    },
    {
      costId: 'c-b-a1',
      companyId: 'lcc',
      projectId: 'prj-b',
      category: 'labor',
      amount: 1_800_000,
      date: d(-12),
      kind: 'actual'
    },
    {
      costId: 'c-b-a2',
      companyId: 'lcc',
      projectId: 'prj-b',
      category: 'material',
      amount: 2_400_000,
      date: d(-12),
      kind: 'actual'
    },
    // C案件: 予定通り進行中
    {
      costId: 'c-c-p1',
      companyId: 'lcc',
      projectId: 'prj-c',
      category: 'labor',
      amount: 1_600_000,
      date: d(-15),
      kind: 'planned'
    },
    {
      costId: 'c-c-p2',
      companyId: 'lcc',
      projectId: 'prj-c',
      category: 'material',
      amount: 2_057_500,
      date: d(-15),
      kind: 'planned'
    },
    {
      costId: 'c-c-a1',
      companyId: 'lcc',
      projectId: 'prj-c',
      category: 'labor',
      amount: 800_000,
      date: d(-5),
      kind: 'actual'
    },
    {
      costId: 'c-c-f1',
      companyId: 'lcc',
      projectId: 'prj-c',
      category: 'labor',
      amount: 800_000,
      date: d(10),
      kind: 'forecast'
    },
    {
      costId: 'c-c-f2',
      companyId: 'lcc',
      projectId: 'prj-c',
      category: 'material',
      amount: 2_057_500,
      date: d(10),
      kind: 'forecast'
    }
  ];

  const invoices: Invoice[] = [
    // D案件: 発行済み・入金待ち（期日は今月20日後）
    {
      invoiceId: 'inv-d',
      companyId: 'lcc',
      projectId: 'prj-d',
      customerId: 'cust-ono',
      amount: 10_000_000,
      issuedAt: d(-4),
      dueDate: d(20),
      status: 'issued'
    },
    // E案件: 入金済み
    {
      invoiceId: 'inv-e',
      companyId: 'lcc',
      projectId: 'prj-e',
      customerId: 'cust-sanin',
      amount: 8_000_000,
      issuedAt: d(-6),
      dueDate: d(-1),
      paidAt: d(-2),
      status: 'paid'
    },
    // 期日超過・未入金
    {
      invoiceId: 'inv-old',
      companyId: 'lcc',
      projectId: 'prj-e',
      customerId: 'cust-sanin',
      amount: 3_300_000,
      issuedAt: d(-36),
      dueDate: d(-6),
      status: 'issued'
    },
    // 金額不一致: 220万円の請求に対し200万円の入金
    {
      invoiceId: 'inv-mm',
      companyId: 'lcc',
      projectId: 'prj-old',
      customerId: 'cust-matsue',
      amount: 2_200_000,
      issuedAt: d(-30),
      dueDate: d(-10),
      paidAt: d(-8),
      status: 'paid'
    }
  ];

  const payments: Payment[] = [
    {
      paymentId: 'pay-e',
      companyId: 'lcc',
      invoiceId: 'inv-e',
      amount: 8_000_000,
      date: d(-2),
      direction: 'in'
    },
    {
      paymentId: 'pay-mm',
      companyId: 'lcc',
      invoiceId: 'inv-mm',
      amount: 2_000_000,
      date: d(-8),
      direction: 'in',
      note: '入金額が請求額と不一致'
    }
  ];

  const cashAccounts: CashAccount[] = [
    {
      accountId: 'acc-gogin',
      companyId: 'lcc',
      bankName: '山陰合同銀行',
      balance: 12_400_000,
      freshness: fresh('銀行明細（前営業日）', 1)
    },
    {
      accountId: 'acc-shimagin',
      companyId: 'lcc',
      bankName: '島根銀行',
      balance: 3_100_000,
      freshness: fresh('銀行明細（前営業日）', 1)
    },
    {
      accountId: 'acc-wel',
      companyId: 'wel',
      bankName: '山陰合同銀行',
      balance: 2_000_000,
      freshness: fresh('銀行明細（前営業日）', 1)
    }
  ];

  const cashPlans: CashPlanEntry[] = [
    // 入金予定
    {
      planId: 'cp-in-d',
      companyId: 'lcc',
      direction: 'in',
      category: 'receipt',
      amount: 10_000_000,
      date: d(20),
      status: 'CONFIRMED',
      label: 'D案件 入金（大野建設）',
      refId: 'inv-d'
    },
    {
      planId: 'cp-in-old',
      companyId: 'lcc',
      direction: 'in',
      category: 'receipt',
      amount: 3_300_000,
      date: d(10),
      status: 'EXPECTED',
      label: '期日超過分の入金見込み（山陰開発）',
      refId: 'inv-old'
    },
    {
      planId: 'cp-in-c',
      companyId: 'lcc',
      direction: 'in',
      category: 'receipt',
      amount: 5_225_000,
      date: d(45),
      status: 'EXPECTED',
      label: 'C案件 完工後入金',
      refId: 'prj-c'
    },
    // 支払予定（月末に外注支払が集中）
    {
      planId: 'cp-out-sal',
      companyId: 'lcc',
      direction: 'out',
      category: 'salary',
      amount: 4_500_000,
      date: d(17),
      status: 'CONFIRMED',
      label: '給与'
    },
    {
      planId: 'cp-out-sub',
      companyId: 'lcc',
      direction: 'out',
      category: 'subcontract',
      amount: 6_800_000,
      date: d(23),
      status: 'CONFIRMED',
      label: '外注支払（月末集中）'
    },
    {
      planId: 'cp-out-pur',
      companyId: 'lcc',
      direction: 'out',
      category: 'purchase',
      amount: 1_200_000,
      date: d(23),
      status: 'CONFIRMED',
      label: '仕入'
    },
    {
      planId: 'cp-out-fix',
      companyId: 'lcc',
      direction: 'out',
      category: 'fixed',
      amount: 1_500_000,
      date: d(23),
      status: 'CONFIRMED',
      label: '固定費（家賃・光熱ほか)'
    },
    {
      planId: 'cp-out-loan',
      companyId: 'lcc',
      direction: 'out',
      category: 'loan',
      amount: 800_000,
      date: d(23),
      status: 'CONFIRMED',
      label: '借入返済'
    },
    {
      planId: 'cp-out-tax',
      companyId: 'lcc',
      direction: 'out',
      category: 'social_insurance',
      amount: 1_300_000,
      date: d(23),
      status: 'CONFIRMED',
      label: '社会保険料'
    },
    {
      planId: 'cp-out-lease',
      companyId: 'lcc',
      direction: 'out',
      category: 'lease',
      amount: 300_000,
      date: d(23),
      status: 'CONFIRMED',
      label: '重機リース'
    },
    // 60日圏の支払（給与・外注の翌月分は予測）
    {
      planId: 'cp-out-sal2',
      companyId: 'lcc',
      direction: 'out',
      category: 'salary',
      amount: 4_500_000,
      date: d(47),
      status: 'EXPECTED',
      label: '給与（翌月）'
    },
    {
      planId: 'cp-out-sub2',
      companyId: 'lcc',
      direction: 'out',
      category: 'subcontract',
      amount: 5_000_000,
      date: d(53),
      status: 'EXPECTED',
      label: '外注支払（翌月見込み）'
    },
    // 福祉法人
    {
      planId: 'cp-wel-in',
      companyId: 'wel',
      direction: 'in',
      category: 'receipt',
      amount: 1_650_000,
      date: d(25),
      status: 'CONFIRMED',
      label: '委託料入金'
    },
    {
      planId: 'cp-wel-sal',
      companyId: 'wel',
      direction: 'out',
      category: 'salary',
      amount: 1_100_000,
      date: d(17),
      status: 'CONFIRMED',
      label: '給与・工賃'
    }
  ];

  // 予定配置（今日）と実績日報（昨日）。「配置=予定」「日報=実績」を明確に分ける
  const assignments: ScheduleAssignment[] = [
    {
      assignmentId: 'asg-1',
      companyId: 'lcc',
      date: d(0),
      projectId: 'prj-a',
      siteName: '出雲市 旧社屋解体現場',
      employeeId: 'emp-tanaka',
      employeeName: '田中'
    },
    {
      assignmentId: 'asg-2',
      companyId: 'lcc',
      date: d(0),
      projectId: 'prj-c',
      siteName: '斐川 アパート改修現場',
      employeeName: '協力会社（解体）'
    }
  ];
  const dailyReports: DailyReportEntry[] = [
    {
      reportId: 'dr-1',
      companyId: 'lcc',
      date: d(-1),
      projectId: 'prj-a',
      siteName: '出雲市 旧社屋解体現場',
      employeeId: 'emp-tanaka',
      employeeName: '田中',
      manDays: 1,
      workDescription: '内装解体・搬出'
    }
  ];

  const salesTargets: SalesTarget[] = [
    { companyId: 'lcc', month: monthOf(asOf), amount: 25_000_000 },
    { companyId: 'wel', month: monthOf(asOf), amount: 1_800_000 }
  ];

  const meta: DatasetMeta = {
    mode: 'demo',
    sources: [
      'CashSource',
      'ProjectSource',
      'EstimateSource',
      'CostSource',
      'InvoiceSource',
      'PaymentSource',
      'CustomerSource',
      'InteractionSource'
    ].map((sourceName) => ({
      sourceName,
      sourceType: 'demo_fixture' as const,
      lastSuccessfulSync: asOf,
      freshness: { lastUpdatedAt: asOf, source: 'Demo Fixture', stale: false },
      confidence: 'HIGH' as const,
      readOnly: true,
      scope: 'all' as const,
      errorState: null
    }))
  };

  return {
    asOf,
    meta,
    companies,
    customers,
    employees,
    vendors,
    projects,
    estimates,
    interactions,
    costs,
    invoices,
    payments,
    cashAccounts,
    cashPlans,
    salesTargets,
    assignments,
    dailyReports
  };
}
