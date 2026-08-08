/**
 * Artifact Content Builders（Phase LIVE-AI）。
 *
 * 成果物の中身を決定論エンジンの実数値から組み立てる。
 * グラフ値・金額をAIに作らせない。LLM接続時は文章表現の改善のみに使う。
 */
import type { CompanyScope } from '../domain/types.js';
import type { CommandDataset } from '../data/seed.js';
import { createHash } from 'node:crypto';
import { computeKpiSnapshot } from '../engines/kpi.js';
import { checkInvoices } from '../engines/invoiceChecks.js';
import { detectSalesLeaks } from '../engines/salesLeak.js';
import { computeProjectMargin } from '../engines/margin.js';
import { filterDatasetByScope } from '../domain/scope.js';
import { buildAlerts, activeAlerts } from '../engines/alerts.js';
import { computeCashForecast, horizonBalance } from '../engines/cashForecast.js';
import { computeSalesSummary } from '../engines/sales.js';
import { yen } from '../brief/generateBrief.js';
import { scopeLabel } from '../domain/scope.js';
import type { DocumentSpec, PresentationSpec, WorkbookSpec } from './renderers.js';
import type { EstimateDraft } from '../estimate/estimateCapability.js';


/**
 * 単一Snapshot原則（§検収2）。
 * 同一リクエスト・同一時点の成果物（UI/PPTX/XLSX/PDF）は同じCanonical Snapshotを使い、
 * 各成果物へ出所（snapshotId/scope/生成時刻/ソース/鮮度/確度/Data Gap）を必ず記録する。
 */
export interface SnapshotStamp {
  snapshotId: string;
  scope: string;
  scopeLabel: string;
  generatedAt: string;
  sources: Array<{ name: string; updatedAt: string; state: string }>;
  freshness: string;
  confidence: string;
  dataGaps: string[];
}

export function buildSnapshotStamp(dataset: CommandDataset, scope: CompanyScope): SnapshotStamp {
  const sources = dataset.meta.sources.map((src) => ({
    name: src.sourceName,
    updatedAt: src.freshness?.lastUpdatedAt ?? '未接続',
    state: src.errorState ? '未接続' : 'OK'
  }));
  const connected = sources.filter((src) => src.state === 'OK');
  const gaps = [
    ...sources.filter((src) => src.state !== 'OK').map((src) => `${src.name}: 未接続`),
  ];
  const key = `${dataset.asOf}|${scope}|${connected.map((src) => `${src.name}@${src.updatedAt}`).join(',')}`;
  return {
    snapshotId: `snap-${createHash('sha256').update(key).digest('hex').slice(0, 10)}`,
    scope: String(scope),
    scopeLabel: scopeLabel(dataset, scope),
    generatedAt: dataset.asOf,
    sources,
    freshness: connected.length > 0 ? (connected.map((src) => src.updatedAt).sort()[0] ?? '不明') + ' 以降' : '接続済みソースなし',
    confidence: gaps.length === 0 ? 'OK' : 'PARTIAL（未接続領域あり）',
    dataGaps: gaps
  };
}

export function stampLines(stamp: SnapshotStamp): string[] {
  return [
    `snapshotId: ${stamp.snapshotId} / scope: ${stamp.scopeLabel}（${stamp.scope}）`,
    `generatedAt: ${stamp.generatedAt}`,
    ...stamp.sources.map((src) => `source: ${src.name} / 更新 ${src.updatedAt} / ${src.state}`),
    `freshness: ${stamp.freshness} / confidence: ${stamp.confidence}`,
    ...(stamp.dataGaps.length > 0 ? [`dataGap: ${stamp.dataGaps.join('、')}`] : ['dataGap: なし'])
  ];
}

const STAGE_LABELS: Record<string, string> = {
  inquiry: '問い合わせ',
  survey: '現地調査',
  estimating: '見積作成中',
  following: '追客中',
  ordered: '受注',
  in_progress: '施工中',
  completed: '完工',
  invoiced: '請求済',
  paid: '入金済',
  lost: '失注'
};
export function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}

const UNCONNECTED = '未接続';

/** 経営会議プレゼン（§16・§検収3）。全数値は決定論エンジン由来。不足は未接続と明示 */
export function buildManagementDeckSpec(
  dataset: CommandDataset,
  scope: CompanyScope,
  stampIn?: SnapshotStamp
): PresentationSpec {
  const stamp = stampIn ?? buildSnapshotStamp(dataset, scope);
  const scoped = filterDatasetByScope(dataset, scope);
  const alerts = buildAlerts(dataset, scope, []);
  const visible = activeAlerts(alerts);
  const kpi = computeKpiSnapshot(dataset, scope, alerts);
  const cash = computeCashForecast(dataset, scope);
  const sales = computeSalesSummary(dataset, scope);
  const invoices = checkInvoices(dataset, scope);
  const leaks = detectSalesLeaks(dataset, scope);
  const kpiValue = (key: string) => kpi.kpis.find((k) => k.key === key)?.value ?? 0;

  // 粗利: 原価データ未接続なら数値を作らない（§検収1）
  const margins = scoped.projects
    .filter((p) => p.orderAmount > 0)
    .map((p) => ({ project: p, margin: computeProjectMargin(dataset, p) }));
  const marginKnown = margins.filter((m) => m.margin.forecastMarginRate !== null);
  const lowMargin = marginKnown.filter(
    (m) => (m.margin.forecastMarginRate as number) < m.margin.plannedMarginRate - 0.03
  );

  // パイプライン: ステージ別件数（実データ）
  const stageOrder = ['inquiry', 'survey', 'estimating', 'following', 'ordered', 'in_progress'];
  const stageCounts = stageOrder.map((stage) => ({
    stage,
    count: scoped.projects.filter((p) => p.stage === stage).length
  }));
  const backlog = scoped.projects.filter((p) => p.stage === 'ordered' || p.stage === 'in_progress');
  const backlogTotal = backlog.reduce((sum, p) => sum + p.orderAmount, 0);
  const owner = (id?: string) => scoped.employees.find((e) => e.employeeId === id)?.name ?? '担当未設定';

  return {
    title: `経営会議資料 — ${stamp.scopeLabel}`,
    subtitle: `基準日 ${stamp.generatedAt.slice(0, 10)} / ${stamp.snapshotId} / scope: ${stamp.scope} / LCC COMMAND生成（数値は決定論エンジン・実データのみ）`,
    slides: [
      {
        title: '経営サマリー',
        bullets: [
          `当月確定売上 ${yen(sales.confirmedSales)} / 着地予測 ${yen(sales.landingForecast)}`,
          `受注残 ${backlog.length}件 ${yen(backlogTotal)}`,
          marginKnown.length > 0
            ? `全社予測粗利率 ${kpiValue('margin_forecast')}%`
            : '粗利率: 原価データ未接続のため算出不能（架空値は表示しません）',
          cash.balanceKnown ? `現預金 ${yen(cash.currentBalance)}` : '現預金: 銀行未接続（UNKNOWN）',
          `重大Alert ${visible.filter((a) => a.severity === 'CRITICAL').length}件 / 警告 ${visible.filter((a) => a.severity === 'WARNING').length}件 / 営業要対応 ${leaks.length}件`
        ]
      },
      {
        title: '売上・着地',
        bullets: [
          `対象月 ${sales.month}`,
          `確定売上（完工済） ${yen(sales.confirmedSales)}`,
          `着地予測（確定+進行中案件） ${yen(sales.landingForecast)}`,
          '売上目標: 正式目標が未承認のため目標比は表示しません（Target Registry承認後に表示）'
        ],
        chart: {
          title: '売上・着地（円）',
          labels: ['確定売上', '着地予測'],
          values: [sales.confirmedSales, sales.landingForecast]
        }
      },
      {
        title: '受注残',
        bullets:
          backlog.length > 0
            ? [
                `受注残 ${backlog.length}件 / 合計 ${yen(backlogTotal)}`,
                ...backlog
                  .slice()
                  .sort((a, b) => b.orderAmount - a.orderAmount)
                  .slice(0, 5)
                  .map(
                    (p) =>
                      `${p.name.slice(0, 30)}（${stageLabel(p.stage)} / ${yen(p.orderAmount)} / ${owner(p.ownerEmployeeId)}）`
                  ),
                ...(backlog.length > 5 ? [`ほか${backlog.length - 5}件（詳細は見積管理Excel参照）`] : [])
              ]
            : ['受注・施工中の案件は登録されていません']
      },
      {
        title: '粗利・低粗利案件',
        bullets:
          marginKnown.length > 0
            ? [
                `粗利算出可能案件 ${marginKnown.length}件 / 予定比▲3pt超の悪化 ${lowMargin.length}件`,
                ...lowMargin
                  .slice(0, 5)
                  .map(
                    (m) =>
                      `${m.project.name.slice(0, 30)}: 予定${Math.round(m.margin.plannedMarginRate * 100)}% → 予測${Math.round((m.margin.forecastMarginRate as number) * 100)}%`
                  )
              ]
            : [
                '原価データ未接続のため粗利は算出できません（データ未接続）',
                '接続後、案件別の予定/予測粗利と悪化要因を自動表示します'
              ]
      },
      {
        title: '営業パイプライン',
        bullets: stageCounts.map((sc) => `${stageLabel(sc.stage)}: ${sc.count}件`),
        chart: {
          title: 'ステージ別件数',
          labels: stageCounts.map((sc) => stageLabel(sc.stage)),
          values: stageCounts.map((sc) => sc.count)
        }
      },
      {
        title: '完工未請求・未入金',
        bullets: [
          `完工未請求 ${yen(invoices.uninvoicedCompletedTotal)}`,
          `期日超過未入金 ${yen(invoices.overdueReceivableTotal)}（入金記録が未接続のため請求発行ベース）`,
          ...invoices.issues.slice(0, 4).map((i) => `${i.title}`),
          ...(invoices.issues.length === 0 ? ['検出された請求課題はありません'] : [])
        ]
      },
      {
        title: '要対応事項',
        bullets:
          visible.length + leaks.length > 0
            ? [
                ...visible.slice(0, 3).map((a) => `[${a.severity}] ${a.title}`),
                ...leaks
                  .slice(0, 4)
                  .map((l) => `[営業] ${l.title} — ${l.projectName.slice(0, 24)}（${l.customerName}）`)
              ]
            : ['即時対応が必要な項目はありません']
      },
      {
        title: 'Data Gap（未接続領域）',
        bullets: [
          ...stamp.dataGaps.map((g) => g),
          '銀行・会計・入金記録・日報の案件紐付けが未接続の間、資金繰り・損益・実績原価は表示しません',
          '未接続領域について「会社全体を判断できる」とは表示しません'
        ]
      },
      {
        title: '社長判断事項',
        bullets: [
          '会社憲法: 候補20原則が承認待ち（「承認事項を見せて」→「全部この内容で確定」）',
          '経営目標: 正式目標が未承認（Target Registry・承認後に目標比を表示）',
          '銀行明細の取得方法の決定（取引先5金融機関は特定済み）',
          ...(lowMargin.length > 0 ? [`低粗利案件${lowMargin.length}件への介入判断`] : [])
        ]
      },
      {
        title: 'データ出所（Snapshot）',
        bullets: stampLines(stamp)
      }
    ]
  };
}

/** 見積書Excel（§17・§23）。金額は決定論計算のみ */
export function buildEstimateWorkbookSpec(draft: EstimateDraft, asOf: string): WorkbookSpec {
  const amount = draft.referenceAmount ?? 0;
  return {
    title: '見積案（草案）',
    sheets: [
      {
        name: '見積案',
        columns: [
          { header: '項目', key: 'item', width: 32 },
          { header: '数量', key: 'qty', width: 10 },
          { header: '単価', key: 'unit', width: 16, numFmt: '#,##0' },
          { header: '金額', key: 'amount', width: 16, numFmt: '#,##0' },
          { header: '区分', key: 'kind', width: 14 }
        ],
        rows: [
          {
            item: `${draft.workKind ?? '工事'}一式（類似${draft.similarProjects.length}件の実績中央値・現場条件で増減）`,
            qty: 1,
            unit: amount,
            amount: { formula: 'B2*C2' },
            kind: '本体'
          },
          { item: '予備費（5%・営業方針）', qty: 1, unit: Math.round(amount * 0.05), amount: { formula: 'B3*C3' }, kind: '予備' },
          { item: '合計（税抜）', qty: null, unit: null, amount: { formula: 'SUM(D2:D3)' }, kind: '' }
        ],
        validations: [{ column: 'kind', type: 'list', options: ['本体', '予備', '処分', '外注', '諸経費'] }]
      },
      {
        name: '前提・不足情報',
        columns: [
          { header: '区分', key: 'kind', width: 14 },
          { header: '内容', key: 'text', width: 70 }
        ],
        rows: [
          { kind: '顧客', text: draft.customer?.name ?? '未特定' },
          { kind: '工種', text: draft.workKind ?? '未特定' },
          ...draft.missingInfo.map((m) => ({ kind: '不足情報', text: m })),
          { kind: '注意', text: 'この草案のまま提出しないでください。金額確定は情報入力後の決定論計算で行います。' },
          { kind: '生成', text: `LCC COMMAND（${asOf.slice(0, 10)}）` }
        ]
      }
    ]
  };
}


/** 見積管理台帳Excel（§検収4）。実案件のみ・19列・粗利は数式/決定論値・不足はUNKNOWN */
export function buildProjectLedgerWorkbookSpec(
  dataset: CommandDataset,
  scope: CompanyScope,
  stampIn?: SnapshotStamp
): WorkbookSpec {
  const stamp = stampIn ?? buildSnapshotStamp(dataset, scope);
  const scoped = filterDatasetByScope(dataset, scope);
  const customerName = new Map(scoped.customers.map((c) => [c.customerId, c.name]));
  const employeeName = new Map(scoped.employees.map((e) => [e.employeeId, e.name]));
  const costsConnected = scoped.costs.length > 0;

  const projects = scoped.projects
    .slice()
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));

  const rows = projects.map((project, index) => {
    const rowNo = index + 2; // 1行目はヘッダ
    const margin = computeProjectMargin(dataset, project);
    const ordered = ['ordered', 'in_progress', 'completed', 'invoiced', 'paid'].includes(project.stage);
    const plannedCost = costsConnected && project.orderAmount > 0
      ? Math.round(project.orderAmount * (1 - project.plannedMarginRate))
      : null;
    return {
      projectId: project.projectId,
      customerId: project.customerId,
      customer: customerName.get(project.customerId) ?? 'UNKNOWN',
      name: project.name,
      stage: stageLabel(project.stage),
      estimateAmount: project.orderAmount > 0 ? project.orderAmount : null,
      orderAmount: ordered && project.orderAmount > 0 ? project.orderAmount : null,
      plannedCost,
      actualCost: costsConnected ? (margin.actualCost ?? null) : null,
      plannedMargin: plannedCost !== null ? { formula: `F${rowNo}-H${rowNo}` } : null,
      forecastMargin:
        margin.forecastMarginRate !== null && project.orderAmount > 0
          ? Math.round(project.orderAmount * margin.forecastMarginRate)
          : null,
      marginRate:
        margin.forecastMarginRate !== null
          ? Math.round(margin.forecastMarginRate * 1000) / 10
          : null,
      estimateDate: null, // 見積日はソース列未接続（UNKNOWN）
      orderDate: project.startDate ?? null,
      dueDate: project.dueDate ?? null,
      owner: employeeName.get(project.ownerEmployeeId ?? '') ?? '',
      updatedAt: project.updatedAt?.slice(0, 10) ?? '',
      source: '統合業務システムDB',
      confidence: costsConnected ? 'HIGH' : '原価UNKNOWN'
    };
  });

  return {
    title: `見積管理台帳 — ${stamp.scopeLabel}`,
    sheets: [
      {
        name: '案件台帳',
        columns: [
          { header: 'projectId', key: 'projectId', width: 14 },
          { header: 'customerId', key: 'customerId', width: 14 },
          { header: '顧客名', key: 'customer', width: 26 },
          { header: '案件名', key: 'name', width: 44 },
          { header: 'ステージ', key: 'stage', width: 11 },
          { header: '見積額', key: 'estimateAmount', width: 13, numFmt: '#,##0' },
          { header: '受注額', key: 'orderAmount', width: 13, numFmt: '#,##0' },
          { header: '予定原価', key: 'plannedCost', width: 13, numFmt: '#,##0' },
          { header: '実績原価', key: 'actualCost', width: 13, numFmt: '#,##0' },
          { header: '予定粗利', key: 'plannedMargin', width: 13, numFmt: '#,##0' },
          { header: '予測粗利', key: 'forecastMargin', width: 13, numFmt: '#,##0' },
          { header: '粗利率%', key: 'marginRate', width: 9 },
          { header: '見積日', key: 'estimateDate', width: 11 },
          { header: '受注日', key: 'orderDate', width: 11 },
          { header: '完工予定日', key: 'dueDate', width: 11 },
          { header: '担当者', key: 'owner', width: 12 },
          { header: '最終更新', key: 'updatedAt', width: 11 },
          { header: 'Source', key: 'source', width: 18 },
          { header: 'Confidence', key: 'confidence', width: 12 }
        ],
        rows
      },
      {
        name: 'メタデータ',
        columns: [
          { header: '項目', key: 'k', width: 20 },
          { header: '値', key: 'v', width: 90 }
        ],
        rows: [
          { k: 'snapshotId', v: stamp.snapshotId },
          { k: 'scope', v: `${stamp.scopeLabel}（${stamp.scope}）` },
          { k: 'generatedAt', v: stamp.generatedAt },
          ...stamp.sources.map((src) => ({ k: 'source', v: `${src.name} / 更新 ${src.updatedAt} / ${src.state}` })),
          { k: 'freshness', v: stamp.freshness },
          { k: 'confidence', v: stamp.confidence },
          { k: 'dataGap', v: stamp.dataGaps.join('、') || 'なし' },
          { k: '注記', v: '原価・見積日は未接続のため空欄/UNKNOWN。架空値では補完しません。' }
        ]
      }
    ]
  };
}

/** 経営報告書（DOCX/PDF・§18-§19・§検収5）。Alertは案件名・担当・工程・期限・根拠付き */
export function buildReportDocumentSpec(
  dataset: CommandDataset,
  scope: CompanyScope,
  stampIn?: SnapshotStamp
): DocumentSpec {
  const stamp = stampIn ?? buildSnapshotStamp(dataset, scope);
  const scoped = filterDatasetByScope(dataset, scope);
  const sales = computeSalesSummary(dataset, scope);
  const cash = computeCashForecast(dataset, scope);
  const alerts = activeAlerts(buildAlerts(dataset, scope, []));
  const leaks = detectSalesLeaks(dataset, scope);
  const invoices = checkInvoices(dataset, scope);
  const employeeName = new Map(scoped.employees.map((e) => [e.employeeId, e.name]));
  const projectById = new Map(scoped.projects.map((p) => [p.projectId, p]));

  const leakDetail = (leak: (typeof leaks)[number]): string[] => {
    const project = projectById.get(leak.projectId);
    const owner = project?.ownerEmployeeId ? (employeeName.get(project.ownerEmployeeId) ?? '担当未設定') : '担当未設定';
    return [
      `■ ${leak.title} — ${leak.projectName}（${leak.customerName}）`,
      `  projectId: ${leak.projectId} / 担当: ${owner} / 現在工程: ${project ? stageLabel(project.stage) : '不明'}`,
      `  不足工程: ${leak.detail}`,
      `  期限: ${project?.dueDate ?? '未設定'} / 最終更新: ${project?.updatedAt?.slice(0, 10) ?? '不明'}`,
      `  根拠: ${leak.evidence.map((e) => `${e.label}=${e.value}`).join(' / ') || '—'}`
    ];
  };

  return {
    title: `経営状況報告 — ${stamp.scopeLabel}（${stamp.generatedAt.slice(0, 10)}）`,
    sections: [
      {
        heading: '売上・着地',
        paragraphs: [
          `当月確定売上は${yen(sales.confirmedSales)}、着地予測は${yen(sales.landingForecast)}です（対象月 ${sales.month}）。`,
          '売上目標は正式承認前のため、目標比は表示しません。'
        ]
      },
      {
        heading: '資金',
        paragraphs: cash.balanceKnown
          ? [`現預金${yen(cash.currentBalance)}。90日以内の最低残高は${yen(cash.minBalance.balance)}（${cash.minBalance.date}）の見込みです。`]
          : ['銀行データ未接続のため、現預金・資金繰り予測は表示しません（架空値では補完しません）。']
      },
      {
        heading: '請求・入金',
        paragraphs: [
          `完工未請求 ${yen(invoices.uninvoicedCompletedTotal)} / 期日超過未入金 ${yen(invoices.overdueReceivableTotal)}（入金記録が未接続のため請求発行ベース）。`
        ]
      },
      {
        heading: `要対応（アラート${alerts.length}件・営業${leaks.length}件）`,
        paragraphs: [
          ...alerts.slice(0, 3).flatMap((a) => {
            const project = a.projectId ? projectById.get(a.projectId) : undefined;
            return [
              `■ [${a.severity}] ${a.title}`,
              `  ${project ? `案件: ${project.name} / projectId: ${project.projectId} / 担当: ${project.ownerEmployeeId ? (employeeName.get(project.ownerEmployeeId) ?? '担当未設定') : '担当未設定'} / 工程: ${stageLabel(project.stage)} / 期限: ${project.dueDate ?? '未設定'}` : a.detail}`,
              `  根拠: ${a.evidence.map((e) => `${e.label}=${e.value}`).join(' / ') || '—'}`
            ];
          }),
          ...leaks.slice(0, 6).flatMap(leakDetail),
          ...(alerts.length + leaks.length === 0 ? ['即時対応が必要な項目はありません。'] : [])
        ]
      },
      {
        heading: 'データ出所（Snapshot）',
        paragraphs: stampLines(stamp)
      }
    ],
    footerNote: `本資料の数値はLCC COMMAND決定論エンジンによる集計です（AI推測値・デモ値を含みません）。${stamp.snapshotId}`
  };
}
