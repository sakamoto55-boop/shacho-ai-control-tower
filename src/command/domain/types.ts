/**
 * LCC COMMAND 経営データモデル。
 *
 * LCC COMMANDは「新しい正本」ではなく、既存の正本を横断して読み、
 * 経営判断へ変換する上位レイヤーである。ここで定義する型は
 * 既存システムのデータを共通IDで読み取るための正規化ビューであり、
 * 既存IDがある場合は externalIds（Mapping Layer）に保持して振り直さない。
 */

/** データ確信度。推測で埋めず、不明は UNKNOWN を返す。 */
export type DataConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

/** データ鮮度ステータス。古いデータで「正常」と断定しないための表示区分。 */
export type FreshnessStatus = 'FRESH' | 'STALE' | 'VERY_STALE' | 'UNKNOWN';

/** RBACロール。UIで隠すだけの制御は禁止し、API側で強制する。 */
export type Role = 'PRESIDENT' | 'EXECUTIVE' | 'MANAGER' | 'STAFF' | 'SYSTEM';

/** APIリクエストの主体。Phase Aはヘッダ/設定由来、Phase Bで実認証（Google Identity等）に置換する。 */
export interface Principal {
  role: Role;
  /** アクセス可能な法人ID。PRESIDENT/SYSTEMは全法人＋グループ横断 */
  companyIds: string[];
  label: string;
}

/** データソースの状態。Canonical Model（CommandDataset）とSource Adapterを分離するためのメタ情報。 */
export interface SourceStatus {
  sourceName: string;
  sourceType:
    | 'demo_fixture'
    | 'google_sheets'
    | 'gas'
    | 'internal_api'
    | 'manual'
    | 'not_configured';
  lastSuccessfulSync: string | null;
  freshness: Freshness | null;
  confidence: DataConfidence;
  readOnly: boolean;
  scope: CompanyScope | 'all';
  errorState: string | null;
}

export interface DatasetMeta {
  /** demo: Demo Fixture由来（明示時のみ）。production: 実ソース由来（未接続なら空データ＋errorState） */
  mode: 'demo' | 'production';
  sources: SourceStatus[];
}

/** アラート重要度。CRITICALのみ即時通知、他は朝Brief等へまとめる。 */
export type AlertSeverity = 'INFO' | 'WATCH' | 'WARNING' | 'CRITICAL';

/**
 * 承認レベル。
 * LEVEL 0: 検索・閲覧（自動） / LEVEL 1: 社内要約・分析（自動）
 * LEVEL 2: 下書き作成（自動） / LEVEL 3: 社内通知（ルール設定）
 * LEVEL 4: 外部送信・データ変更（承認） / LEVEL 5: 支払・契約・人事等（強い承認）
 */
export type ActionRiskLevel = 0 | 1 | 2 | 3 | 4 | 5;

/** 法人スコープ。'group' はグループ全体（AIが勝手に法人間データを混在させない）。 */
export type CompanyScope = 'group' | string;

/** 主要データの鮮度。古いデータを現在値として断定しないために全KPIへ付与する。 */
export interface Freshness {
  lastUpdatedAt: string;
  /** 取得元（例: '会計システム' '銀行API' '手入力'）。AI生成値をソースにしてはならない。 */
  source: string;
  /** 最新でない場合 true（回答時に「最新ではありません」と明示する） */
  stale: boolean;
}

/** 回答・数値の根拠。AIが生成した数字を根拠として扱ってはならない。 */
export interface Evidence {
  label: string;
  value: string;
  /** 参照した正本レコードのID（project_id など） */
  refId?: string;
  source: string;
  asOf: string;
}

// ---------------------------------------------------------------------------
// マスタ
// ---------------------------------------------------------------------------

export interface Company {
  companyId: string;
  name: string;
  /** 既存システムのIDを振り直さないためのMapping Layer */
  externalIds?: Record<string, string>;
}

export interface Customer {
  customerId: string;
  companyId: string;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  externalIds?: Record<string, string>;
}

export interface Employee {
  employeeId: string;
  companyId: string;
  name: string;
  role: string;
  externalIds?: Record<string, string>;
}

export interface Vendor {
  vendorId: string;
  companyId: string;
  name: string;
  category: string;
}

// ---------------------------------------------------------------------------
// 案件・営業
// ---------------------------------------------------------------------------

/** 案件のライフサイクル: 問い合わせ→現調→見積→追客→受注→施工→完工→請求→入金 */
export type ProjectStage =
  | 'inquiry'
  | 'survey'
  | 'estimating'
  | 'following'
  | 'ordered'
  | 'in_progress'
  | 'completed'
  | 'invoiced'
  | 'paid'
  | 'lost';

export type StageConfidence = 'CONFIRMED' | 'PROVISIONAL' | 'UNKNOWN';
export type AmountConfidence = 'HIGH' | 'LOW' | 'UNKNOWN';

export interface Project {
  projectId: string;
  companyId: string;
  customerId: string;
  name: string;
  /** 'unknown' = Source status の意味監査が未了で分類しない（勝手に既定ステージへ変換しない） */
  stage: ProjectStage | 'unknown';
  /** Source側の生status値（意味監査の対象。DATA_SEMANTICS_AUDIT.md参照） */
  sourceStatus?: string;
  stageConfidence: StageConfidence;
  /**
   * 契約確定額。契約額が確認できない場合はnull（0円へ変換しない）。
   * 集計は「金額確認済のみ合計+件数カバレッジ併記」が原則
   */
  orderAmount: number | null;
  /** 見積額（Source: estimateTotal等）。未入力はnull */
  estimateAmount: number | null;
  orderAmountSource: 'CONTRACT' | 'ESTIMATE' | 'NONE';
  amountConfidence: AmountConfidence;
  /** 見積時の予定粗利率（0-1）。不明はnull（0へ変換しない） */
  plannedMarginRate: number | null;
  startDate?: string;
  dueDate?: string;
  completedDate?: string;
  ownerEmployeeId?: string;
  /** 担当者表示名（Source staff列。employeeマスタ接続前の暫定表示） */
  ownerName?: string;
  /** Source側レコードの実更新時刻。実更新列が無いSourceではnull（取得時刻で偽装しない） */
  sourceRecordUpdatedAt?: string | null;
  /** システムがSourceから取得した時刻 */
  snapshotFetchedAt: string;
  updatedAt: string;
  externalIds?: Record<string, string>;
}

export interface Estimate {
  estimateId: string;
  companyId: string;
  projectId: string;
  amount: number;
  submittedAt?: string;
  /** 受注可能性 0-1（営業入力。AI推測値を入れない） */
  probability?: number;
  status: 'draft' | 'submitted' | 'ordered' | 'lost';
}

/** 営業接点。取得不能チャネルは簡易入力で残す。 */
export interface Interaction {
  interactionId: string;
  companyId: string;
  customerId: string;
  projectId?: string;
  employeeId?: string;
  channel: 'gmail' | 'lineworks' | 'phone' | 'visit' | 'manual' | 'other';
  datetime: string;
  summary: string;
  nextAction?: string;
  nextActionDate?: string;
}

/**
 * 予定配置（デジタル配置板）。「誰をどこに配置する予定か」であり実績ではない。
 * 予定配置を実績人工として扱わない（原価計算にはDailyReportEntryを使う）。
 */
export interface ScheduleAssignment {
  assignmentId: string;
  companyId: string;
  date: string;
  projectId?: string;
  siteName: string;
  employeeId?: string;
  employeeName: string;
  vehicle?: string;
  note?: string;
}

/** 実績日報。実際に行った作業の記録。工数（人工）はこちらが根拠。 */
export interface DailyReportEntry {
  reportId: string;
  companyId: string;
  date: string;
  projectId?: string;
  siteName: string;
  employeeId?: string;
  employeeName: string;
  /** 人工（1.0=1人日） */
  manDays: number;
  workDescription?: string;
  subcontractorName?: string;
}

/** 月次売上目標（経営者・幹部が設定する確定値。AIが生成しない） */
export interface SalesTarget {
  companyId: string;
  /** 'YYYY-MM' */
  month: string;
  amount: number;
}

// ---------------------------------------------------------------------------
// 原価・粗利
// ---------------------------------------------------------------------------

/** 原価カテゴリー（既存分類に合わせる） */
export type CostCategory =
  | 'labor' // 人工
  | 'subcontract' // 外注
  | 'disposal' // 処分
  | 'material' // 材料
  | 'vehicle' // 車両
  | 'machine' // 重機
  | 'transport' // 運搬
  | 'other'; // その他

export const COST_CATEGORY_LABELS: Record<CostCategory, string> = {
  labor: '人工',
  subcontract: '外注',
  disposal: '処分',
  material: '材料',
  vehicle: '車両',
  machine: '重機',
  transport: '運搬',
  other: 'その他'
};

export interface CostEntry {
  costId: string;
  companyId: string;
  projectId: string;
  category: CostCategory;
  amount: number;
  date: string;
  /** 見積時の予定原価か、発生済み実績か、今後の予測か */
  kind: 'planned' | 'actual' | 'forecast';
  note?: string;
}

/** 案件粗利。予定・予測・実績を分離する。 */
export interface ProjectMargin {
  projectId: string;
  projectName: string;
  companyId: string;
  orderAmount: number | null;
  plannedMarginRate: number | null;
  forecastMarginRate: number | null;
  actualMarginRate: number | null;
  plannedCost: number;
  forecastCost: number;
  actualCost: number;
  costByCategory: Record<CostCategory, { planned: number; forecastAndActual: number }>;
  /** 見積比で悪化している主因カテゴリ（差額降順） */
  varianceDrivers: Array<{ category: CostCategory; label: string; diff: number }>;
  freshness: Freshness;
  evidence: Evidence[];
}

// ---------------------------------------------------------------------------
// 請求・入金
// ---------------------------------------------------------------------------

export interface Invoice {
  invoiceId: string;
  companyId: string;
  projectId: string;
  customerId: string;
  amount: number;
  issuedAt?: string;
  dueDate?: string;
  paidAt?: string;
  status: 'draft' | 'issued' | 'paid' | 'overdue';
  externalIds?: Record<string, string>;
}

export interface Payment {
  paymentId: string;
  companyId: string;
  invoiceId?: string;
  amount: number;
  date: string;
  direction: 'in' | 'out';
  note?: string;
}

// ---------------------------------------------------------------------------
// 資金繰り
// ---------------------------------------------------------------------------

export interface CashAccount {
  accountId: string;
  companyId: string;
  bankName: string;
  balance: number;
  /** 残高の最終更新（銀行残高は前営業日など。古い場合は明示する） */
  freshness: Freshness;
}

export type CashPlanCategory =
  | 'salary' // 給与
  | 'subcontract' // 外注
  | 'purchase' // 仕入
  | 'fixed' // 固定費
  | 'loan' // 借入返済
  | 'tax' // 税金
  | 'social_insurance' // 社会保険
  | 'card' // カード
  | 'lease' // リース
  | 'intercompany' // 法人間資金移動
  | 'one_time' // 一時支出
  | 'receipt' // 入金
  | 'other';

export const CASH_PLAN_CATEGORY_LABELS: Record<CashPlanCategory, string> = {
  salary: '給与',
  subcontract: '外注',
  purchase: '仕入',
  fixed: '固定費',
  loan: '借入返済',
  tax: '税金',
  social_insurance: '社会保険',
  card: 'カード',
  lease: 'リース',
  intercompany: '法人間資金移動',
  one_time: '一時支出',
  receipt: '入金',
  other: 'その他'
};

/**
 * 入金予定・支払予定。確定と予測を混ぜないため必ずstatusを持つ。
 * CONFIRMED=確定 / EXPECTED=予定（相手合意済み等） / ESTIMATED=推計（シナリオ・概算）
 */
export type CashPlanStatus = 'CONFIRMED' | 'EXPECTED' | 'ESTIMATED';

export interface CashPlanEntry {
  planId: string;
  companyId: string;
  direction: 'in' | 'out';
  category: CashPlanCategory;
  amount: number;
  date: string;
  status: CashPlanStatus;
  label: string;
  /** 紐づく請求など */
  refId?: string;
}

/** シナリオ分析の調整。「A社の入金が10日遅れたら？」「来月500万円の車両を買ったら？」 */
export type CashScenarioAdjustment =
  | { kind: 'delay_entry'; planId: string; days: number }
  | { kind: 'add_payment'; amount: number; date: string; label: string }
  | { kind: 'add_receipt'; amount: number; date: string; label: string }
  | { kind: 'remove_entry'; planId: string };

export interface CashForecastPoint {
  date: string;
  daysAhead: number;
  balance: number;
  /** 予測分（certainty='forecast'）を除いた確定ベース残高 */
  confirmedOnlyBalance: number;
}

export interface CashForecastResult {
  scope: CompanyScope;
  asOf: string;
  /** 口座データが1件もない場合は false（残高0と混同しない） */
  balanceKnown: boolean;
  currentBalance: number;
  points: CashForecastPoint[];
  /** 90日分の日次残高推移 */
  dailyBalances: Array<{ date: string; balance: number; confirmedOnlyBalance: number }>;
  /** 期間中の最低残高（資金ショート検知用） */
  minBalance: { date: string; balance: number };
  entries: CashPlanEntry[];
  /** 重複排除で除外したエントリ（同一planId／同一内容） */
  duplicatesRemoved: CashPlanEntry[];
  freshness: Freshness;
  freshnessStatus: FreshnessStatus;
  evidence: Evidence[];
}

/** シナリオ前後の差分表示用 */
export interface CashForecastDiff {
  horizonDiffs: Array<{ daysAhead: number; base: number; scenario: number; diff: number }>;
  minBalanceBase: { date: string; balance: number };
  minBalanceScenario: { date: string; balance: number };
}

// ---------------------------------------------------------------------------
// 経営判断Memory・タスク・承認・アラート
// ---------------------------------------------------------------------------

/**
 * 経営判断の構造化記録。会話全部ではなく、経営上意味のあるDecisionのみ保存する。
 * 有効期間中はAIが同じ警告を繰り返さず、期限切れ後に再評価する。
 */
export interface Decision {
  decisionId: string;
  companyId: string;
  projectId?: string;
  date: string;
  decision: string;
  /** 必須。理由のないDecisionは保存しない */
  reason: string;
  /** 必須。誰の判断かを常に残す */
  decisionMaker: string;
  /** 必須。永久に警告を消す事故を防ぐため期限のないDecisionは作れない */
  validUntil: string;
  status: 'active' | 'expired' | 'revoked';
  /** 抑制対象のアラート種別（例: 'margin_drop'） */
  suppressAlertKinds?: string[];
}

export interface CommandTask {
  taskId: string;
  source: 'conversation' | 'system' | 'manual';
  companyId: string;
  projectId?: string;
  owner?: string;
  title: string;
  dueDate?: string;
  priority: 'high' | 'medium' | 'low';
  status: 'candidate' | 'confirmed' | 'done' | 'rejected';
  evidence: Evidence[];
  createdAt: string;
}

/** 承認リクエスト。LEVEL 4以上のWrite Toolは必ずこれを経由する。 */
export interface ApprovalRequest {
  approvalId: string;
  companyId: string;
  riskLevel: ActionRiskLevel;
  action: string;
  target: string;
  amount?: number;
  before?: string;
  after?: string;
  aiReason: string;
  evidence: Evidence[];
  status: 'waiting' | 'approved' | 'rejected' | 'executed_dry_run';
  createdAt: string;
  decidedAt?: string;
  /** 実行結果（Phase A は全て dry-run） */
  executionResult?: string;
}

export type AlertKind =
  | 'cash_low' // 将来現金残高の低下
  | 'sales_landing_gap' // 売上着地の目標比不足
  | 'margin_drop' // 予測粗利の悪化
  | 'inquiry_unanswered' // 問い合わせ24時間未対応
  | 'estimate_not_submitted' // 現調後見積未提出
  | 'no_follow_up' // 見積提出後追客なし
  | 'stalled' // 30日以上停滞
  | 'no_next_step' // 受注後次工程未設定
  | 'uninvoiced_completed' // 完工未請求
  | 'invoice_overdue' // 請求期限超過
  | 'payment_overdue' // 請求済未入金・入金予定超過
  | 'amount_mismatch'; // 金額不一致

export interface CommandAlert {
  alertId: string;
  kind: AlertKind;
  severity: AlertSeverity;
  companyId: string;
  projectId?: string;
  title: string;
  detail: string;
  evidence: Evidence[];
  /** Decision Memory により抑制されている場合、その decisionId */
  suppressedByDecisionId?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// 外部Research
// ---------------------------------------------------------------------------

/** 外部調査タスク。社内の確定数値計算には使用しない。非同期で状態管理する。 */
export interface ResearchTask {
  researchId: string;
  companyId: string;
  question: string;
  provider: 'manus' | 'web_search' | 'other';
  status: 'queued' | 'running' | 'waiting' | 'completed' | 'failed';
  requestedAt: string;
  completedAt?: string;
  /** 出典URL・取得日時付きの結果。社内事実と明確に分離して表示する。 */
  result?: { summary: string; sources: Array<{ url: string; fetchedAt: string }> };
}

// ---------------------------------------------------------------------------
// KPI・Brief・会話
// ---------------------------------------------------------------------------

export interface KpiValue {
  key: string;
  label: string;
  value: number | null;
  unit: 'yen' | 'percent' | 'count';
  freshness: Freshness;
  freshnessStatus: FreshnessStatus;
  confidence: DataConfidence;
}

export type DataStatus = 'OK' | 'PARTIAL' | 'DATA_UNAVAILABLE';

export interface KpiSnapshot {
  scope: CompanyScope;
  asOf: string;
  dataStatus: DataStatus;
  kpis: KpiValue[];
}

export interface ExecutiveBrief {
  scope: CompanyScope;
  generatedAt: string;
  headline: string;
  /** 昨日から何が変わったか（単なる数字羅列より優先） */
  changes: string[];
  decisionsNeeded: string[];
  recommendedActions: string[];
  kpiSnapshot: KpiSnapshot;
  alerts: CommandAlert[];
  text: string;
}

/** Generative UI のヒント。AI回答を文章だけにしない。 */
export type UiHint =
  | 'text'
  | 'chart'
  | 'cash_table'
  | 'ranking'
  | 'project_card'
  | 'pipeline'
  | 'tasks'
  | 'brief'
  | 'approval';

export interface CommandChatRequest {
  scope?: CompanyScope;
  message: string;
  /** 会話コンテキスト（代名詞解決・追い質問）を維持するセッションID */
  sessionId?: string;
  /** テストや再現用に基準日時を注入できる（省略時は現在時刻） */
  asOf?: string;
}

export interface CommandChatResponse {
  /** 事実と推測を分離した日本語回答 */
  text: string;
  /** データ取得状態。DATA_UNAVAILABLE時は数値を一切断定しない */
  dataStatus: DataStatus;
  uiHint: UiHint;
  /** UI描画用の構造化データ（uiHintに応じた形） */
  data?: unknown;
  confidence: DataConfidence;
  evidence: Evidence[];
  /** 実行したRead Tool名 */
  toolsUsed: string[];
  /** 生成された承認リクエスト（Write Tool経由時のみ） */
  approvalRequest?: ApprovalRequest;
}
