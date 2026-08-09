/**
 * Data Gap Registry（Phase B1.5 §9-§10）。
 *
 * 不足データを場当たり的に扱わず、「何が・なぜ・どこまで」不足しているかを
 * Evidence付きで一元管理する。UNKNOWNの放置も、推測での接続もしない。
 * 初期エントリはB0/B1/B1.5のREAD ONLY実測に基づく（REAL_DATA_SOURCE_MAP.md参照）。
 */

export type DataGapSeverity = 'HIGH' | 'MEDIUM' | 'LOW';
export type DataGapStatus = 'OPEN' | 'INVESTIGATING' | 'SOURCE_IDENTIFIED' | 'RESOLVED';

export interface DataGap {
  gapId: string;
  domain: 'OPERATIONS' | 'FINANCE' | 'SALES' | 'HR' | 'TARGETS';
  description: string;
  requiredFor: string[];
  severity: DataGapSeverity;
  /** 現在その用途に使われているもの（なければ 'なし'） */
  currentSource: string;
  /** 正本候補（実測で特定できたもの。未特定はUNKNOWN） */
  expectedSource: string;
  status: DataGapStatus;
  discoveredAt: string;
  evidence: string[];
  recommendedAction: string;
  /** このGapが会話Capabilityへ与える影響 */
  capabilityImpact: string;
}

/** B1.5時点の実測に基づく登録済みData Gap */
export const DATA_GAPS: DataGap[] = [
  {
    gapId: 'DG-001',
    domain: 'OPERATIONS',
    description:
      '実績日報の正本が確定していない（AI読み取りドラフトはあるが確定運用が未完成）',
    requiredFor: ['actual labor cost（実績人工原価）', 'project progress', 'yesterday workforce'],
    severity: 'HIGH',
    currentSource:
      'スプレッドシート「日報データ（AI読み取り）」(19nu2KzprKgf5NOLxsgh-TXaau0zkjisx3d19Eia5MZ8) — ホワイトボード写真をAIが読み取ったドラフト（工数・AI信頼度・確認ステータス列あり）',
    expectedSource:
      '同シートの「確定（✔で転記対象）」済み行、または配置板DBの日報タブ（現在0行）',
    status: 'SOURCE_IDENTIFIED',
    discoveredAt: '2026-08-08',
    evidence: [
      '配置板DBの配置・段取り・車両配置・現場タブは実測0行（2026-08-04時点）',
      '「日報データ（AI読み取り）」は2026-08-07更新。日付・現場・作業員・工数・AI信頼度・確認ステータス・確定列を持ち、2026-06〜07の実データ行あり',
      '作業日報のホワイトボード写真がDriveへ毎日アップロードされている（8/8分まで確認。例: 「８月8日「土曜日」作業日報17名…」）',
      'GASプロジェクト「LCCデジタル配置板」が存在（2026-08-03更新）'
    ],
    recommendedAction:
      '「日報データ（AI読み取り）」の確定済み行のみをDailyReportSourceとして接続する（未確認行は実績に使わない）。現場名→prj_ IDの紐付けルールが別途必要',
    capabilityImpact: 'LABOR_ACTUAL = UNKNOWN（実績人工を原価計算に使えない）'
  },
  {
    gapId: 'DG-002',
    domain: 'OPERATIONS',
    description: '配置予定（今日の現場・誰がどこ）のデジタル正本が未稼働',
    requiredFor: ['today assignments（今日の配置）', 'schedule conflicts', '車両配置'],
    severity: 'MEDIUM',
    currentSource:
      '物理ホワイトボード（写真としてDriveに記録）+「日報データ（AI読み取り）」の配置板タブ（日次上書き型）',
    expectedSource: 'LCCデジタル配置板DB 配置/段取り/車両配置タブ（構造あり・データ0行）',
    status: 'SOURCE_IDENTIFIED',
    discoveredAt: '2026-08-08',
    evidence: [
      '配置板DBは社員60/車両27/協力会社6のマスタのみ実データ、運用タブは空',
      '「日報データ（AI読み取り）」配置板タブはB1セルの日付で切り替わる当日ビュー（履歴を持たない）'
    ],
    recommendedAction:
      'デジタル配置板の本番運用開始を待つ（システム側はScheduleSource接続口を用意済み）。それまで「今日の配置」はNOT_ANSWERABLEと明示する',
    capabilityImpact: '「今日の現場は？」に実データで回答できない'
  },
  {
    gapId: 'DG-003',
    domain: 'OPERATIONS',
    description: '日報・配置の現場名と統合業務システムの案件ID（prj_）の紐付けキーがない',
    requiredFor: ['案件別実績原価', '案件進捗と日報の突合'],
    severity: 'MEDIUM',
    currentSource: 'なし（日報側は「一成建設」等の現場/発注元名のみ）',
    expectedSource: 'LCC_CASE_DBのhaichi_key列（設計あり・値は未入力）または現場マスタ',
    status: 'OPEN',
    discoveredAt: '2026-08-08',
    evidence: [
      '「日報データ（AI読み取り）」の現場列は自由記載名で、prj_ / boardId を持たない',
      'LCC_CASE_DB 01_projectsにhaichi_key列が存在するが全行空'
    ],
    recommendedAction: '現場名→案件IDの対応表（Crosswalk）の運用ルールを決める（ユーザー判断が必要）',
    capabilityImpact: '日報が接続できても案件別の原価配賦ができない'
  },
  {
    gapId: 'DG-004',
    domain: 'FINANCE',
    description: '銀行残高・入出金明細のソースが未特定',
    requiredFor: ['current cash', '30/60/90日資金繰り予測', '入金消込'],
    severity: 'HIGH',
    currentSource: 'なし',
    expectedSource: 'UNKNOWN（推測で接続しない）',
    status: 'OPEN',
    discoveredAt: '2026-08-08',
    evidence: [
      'Drive READ ONLY実測でも銀行明細・残高シートを未発見',
      '印刷版経営計画書の配付先一覧（特No.1〜5）から取引先とみられる金融機関5「機関」を確認: 山陰合同銀行島根医大通支店・鳥取銀行出雲支店・ごうぎんリース出雲支店・日本政策金融公庫松江支店・島根中央信用金庫出雲西支店（※明細5行の意味ではない。口座の存在・明細データの所在はEvidence未確認のため資金繰りSourceには未採用）'
    ],
    recommendedAction:
      '上記金融機関の口座有無と、明細CSV/残高転記シートの取得方法をユーザーへ確認する（推測で接続しない）',
    capabilityImpact:
      'Current Cash Confidence = UNKNOWN → 30/60/90 Cash Forecast = INCOMPLETE（回答には常に未接続の注記を付ける）'
  },
  {
    gapId: 'DG-005',
    domain: 'FINANCE',
    description: '会計システム（試算表・仕訳）のソースが未特定',
    requiredFor: ['月次損益', '固定費', '粗利の会計突合'],
    severity: 'MEDIUM',
    currentSource: 'なし',
    expectedSource: 'UNKNOWN（推測で接続しない）',
    status: 'OPEN',
    discoveredAt: '2026-08-08',
    evidence: ['Drive READ ONLY実測でも試算表・仕訳エクスポートを未発見'],
    recommendedAction: '会計ソフト名とエクスポート可否をユーザーへ確認する',
    capabilityImpact: '損益・固定費関連の質問はNOT_ANSWERABLE'
  },
  {
    gapId: 'DG-006',
    domain: 'SALES',
    description: '入金実績（Payment）の記録列が未整備',
    requiredFor: ['期日超過未入金の実測', '回収状況'],
    severity: 'MEDIUM',
    currentSource: '統合業務システムDB projectsのinvoiceDate/invoiceTotal（発行側のみ）',
    expectedSource: '統合業務システムDBの入金列 or 銀行明細（DG-004）',
    status: 'OPEN',
    discoveredAt: '2026-08-08',
    evidence: ['統合業務システムDBの請求書タブは0行。入金日・入金額の列は未確認'],
    recommendedAction: '入金の記録場所（経理運用）をユーザーへ確認する',
    capabilityImpact: '「未入金どこ？」は請求発行ベースの部分回答のみ（PARTIAL）'
  },
  {
    gapId: 'DG-007',
    domain: 'TARGETS',
    description: '正式な経営目標が未承認（経営管理第13期は仮値と明記）',
    requiredFor: ['目標比の着地評価', '部門KPI評価'],
    severity: 'MEDIUM',
    currentSource: 'なし（Target RegistryにCANDIDATEのみ登録可能）',
    expectedSource: 'Target Registry（ユーザー承認でACTIVE化）',
    status: 'SOURCE_IDENTIFIED',
    discoveredAt: '2026-08-08',
    evidence: [
      '経営管理第13期シート自身に「均等割仮値が残っています…経営判断の参考資料として使わない」と明記',
      '同シートは2026-04-01から更新停止'
    ],
    recommendedAction:
      '解体課 月26.3百万円等の候補値をCANDIDATE登録し、社長の承認でACTIVE化する',
    capabilityImpact: '「目標比どう？」は暫定値である旨の注記付きでしか回答できない'
  }
];

export function findGap(gapId: string): DataGap | undefined {
  return DATA_GAPS.find((gap) => gap.gapId === gapId);
}

export function openGaps(): DataGap[] {
  return DATA_GAPS.filter((gap) => gap.status !== 'RESOLVED');
}
