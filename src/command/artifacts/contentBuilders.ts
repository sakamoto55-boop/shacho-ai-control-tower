/**
 * Artifact Content Builders（Phase LIVE-AI）。
 *
 * 成果物の中身を決定論エンジンの実数値から組み立てる。
 * グラフ値・金額をAIに作らせない。LLM接続時は文章表現の改善のみに使う。
 */
import type { CompanyScope } from '../domain/types.js';
import type { CommandDataset } from '../data/seed.js';
import { computeKpiSnapshot } from '../engines/kpi.js';
import { buildAlerts, activeAlerts } from '../engines/alerts.js';
import { computeCashForecast, horizonBalance } from '../engines/cashForecast.js';
import { computeSalesSummary } from '../engines/sales.js';
import { yen } from '../brief/generateBrief.js';
import { scopeLabel } from '../domain/scope.js';
import type { DocumentSpec, PresentationSpec, WorkbookSpec } from './renderers.js';
import type { EstimateDraft } from '../estimate/estimateCapability.js';

/** 経営会議プレゼン（§16）。全数値は決定論エンジン由来 */
export function buildManagementDeckSpec(dataset: CommandDataset, scope: CompanyScope): PresentationSpec {
  const alerts = buildAlerts(dataset, scope, []);
  const visible = activeAlerts(alerts);
  const kpi = computeKpiSnapshot(dataset, scope, alerts);
  const cash = computeCashForecast(dataset, scope);
  const sales = computeSalesSummary(dataset, scope);
  const kpiValue = (key: string) => kpi.kpis.find((k) => k.key === key)?.value ?? 0;

  return {
    title: `経営会議資料 — ${scopeLabel(dataset, scope)}`,
    subtitle: `基準日 ${dataset.asOf.slice(0, 10)} / LCC COMMAND生成（数値は決定論エンジン）`,
    slides: [
      {
        title: '経営サマリー',
        bullets: [
          `当月売上 ${yen(sales.confirmedSales)} / 着地予測 ${yen(sales.landingForecast)}`,
          `受注残 ${yen(kpiValue('order_backlog'))}`,
          `全社予測粗利率 ${kpiValue('margin_forecast')}%`,
          `重大Alert ${visible.filter((a) => a.severity === 'CRITICAL').length}件 / 警告 ${visible.filter((a) => a.severity === 'WARNING').length}件`
        ]
      },
      {
        title: '資金状況',
        bullets: cash.balanceKnown
          ? [
              `現預金 ${yen(cash.currentBalance)}`,
              `30日後 ${yen(horizonBalance(cash, 30))} / 60日後 ${yen(horizonBalance(cash, 60))} / 90日後 ${yen(horizonBalance(cash, 90))}`,
              `期間中最低残高 ${yen(cash.minBalance.balance)}（${cash.minBalance.date}）`
            ]
          : ['銀行残高未接続のため、資金予測は不完全（INCOMPLETE）です'],
        chart: cash.balanceKnown
          ? {
              title: '資金予測（円）',
              labels: ['現在', '30日', '60日', '90日'],
              values: [cash.currentBalance, horizonBalance(cash, 30), horizonBalance(cash, 60), horizonBalance(cash, 90)]
            }
          : undefined,
        note: '銀行データ未接続のため登録済み口座残高ベース'
      },
      {
        title: '要対応事項',
        bullets:
          visible.length > 0 ? visible.slice(0, 6).map((a) => `[${a.severity}] ${a.title}`) : ['即時対応が必要な項目はありません']
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

/** 経営報告書（DOCX/PDF・§18-§19） */
export function buildReportDocumentSpec(dataset: CommandDataset, scope: CompanyScope): DocumentSpec {
  const sales = computeSalesSummary(dataset, scope);
  const cash = computeCashForecast(dataset, scope);
  const alerts = activeAlerts(buildAlerts(dataset, scope, []));
  return {
    title: `経営状況報告 — ${scopeLabel(dataset, scope)}（${dataset.asOf.slice(0, 10)}）`,
    sections: [
      {
        heading: '売上',
        paragraphs: [
          `当月確定売上は${yen(sales.confirmedSales)}、着地予測は${yen(sales.landingForecast)}です。`
        ]
      },
      {
        heading: '資金',
        paragraphs: cash.balanceKnown
          ? [`現預金${yen(cash.currentBalance)}。90日以内の最低残高は${yen(cash.minBalance.balance)}（${cash.minBalance.date}）の見込みです。`]
          : ['銀行残高が未接続のため、完全な資金予測ではありません。']
      },
      {
        heading: '要対応',
        paragraphs: alerts.length > 0 ? alerts.slice(0, 5).map((a) => `[${a.severity}] ${a.title}`) : ['即時対応が必要な項目はありません。']
      }
    ],
    footerNote: '本資料の数値はLCC COMMAND決定論エンジンによる集計です（AI推測値を含みません）。'
  };
}
