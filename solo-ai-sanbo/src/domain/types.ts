/**
 * 一人事業のAI参謀が扱う型。
 *
 * 前提：働き手は自分ひとり。増やせるのは時間ではなく「時間あたりの成果」だけ。
 * そのため、この仕組みは「柱（何で稼ぐか）」「時間」「お金」「案件」の4つだけを数える。
 */

/** 収益の柱の種類 */
export type PillarKind =
  | 'service' // 手を動かして納める仕事（解体・工事の個人受注など）
  | 'content' // 発信して広告・商品・紹介につなげる
  | 'contract' // 受託・代行（AI活用支援など）
  | 'other';

/**
 * 柱の状態。
 * testing = 検証中（撤退基準つき）／active = 主力／paused = 一時停止／dropped = 撤退済み
 */
export type PillarStatus = 'testing' | 'active' | 'paused' | 'dropped';

export interface Pillar {
  id: string;
  name: string;
  kind: PillarKind;
  status: PillarStatus;
  /** 開始日 YYYY-MM-DD */
  startedOn: string;
  /**
   * 見直し日 YYYY-MM-DD。
   * 検証中の柱は「いつ判断するか」を先に決めておく。決めないと惰性で続く。
   */
  reviewOn: string | null;
  /** 見直し日までに超えたい月の粗利（円）。撤退基準そのもの。 */
  targetMonthlyProfitYen: number | null;
  note: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 案件の段階。一人で回せる粒度に絞っている。
 * 納品後の請求と入金を分けているのは、一人事業では入金漏れが直接生活に響くため。
 */
export type DealStage =
  | 'inquiry' // 引き合いが来た
  | 'talking' // やり取り中
  | 'quoted' // 見積を出した
  | 'won' // 受注
  | 'delivering' // 作業中
  | 'invoiced' // 請求済み
  | 'paid' // 入金済み
  | 'lost'; // 失注

export interface Deal {
  id: string;
  pillarId: string;
  title: string;
  clientName: string;
  contact: string;
  stage: DealStage;
  /** 見込みまたは確定金額（円）。未定はnull。 */
  amountYen: number | null;
  /** 外注・材料・交通費など、この案件に直接かかる費用（円） */
  costYen: number;
  nextAction: string;
  /** 次アクションの期限 YYYY-MM-DD */
  nextActionOn: string | null;
  /** 最後に動かした日 YYYY-MM-DD。放置の検知に使う。 */
  lastTouchedOn: string;
  memo: string;
  createdAt: string;
  updatedAt: string;
}

/** 時間の使いみち。稼ぎに直結する時間とそうでない時間を分けて見る。 */
export type TimeCategory =
  | 'sales' // 営業・見込み客対応
  | 'delivery' // 実作業・納品
  | 'content' // 発信・制作
  | 'admin' // 事務・経理・移動
  | 'learning'; // 学習・仕込み

export interface TimeEntry {
  id: string;
  pillarId: string;
  dealId: string | null;
  /** YYYY-MM-DD */
  date: string;
  minutes: number;
  category: TimeCategory;
  note: string;
  createdAt: string;
}

export interface MoneyEntry {
  id: string;
  pillarId: string;
  dealId: string | null;
  /** YYYY-MM-DD */
  date: string;
  kind: 'income' | 'expense';
  amountYen: number;
  label: string;
  createdAt: string;
}

/** 期間 YYYY-MM-DD */
export interface DateRange {
  from?: string;
  to?: string;
}

/** 柱1本の成績。時給（profitPerHourYen）がこの仕組みの主役。 */
export interface PillarSummary {
  pillar: Pillar;
  hours: number;
  incomeYen: number;
  expenseYen: number;
  profitYen: number;
  /** 1時間あたりいくら生んだか。時間が唯一の資源なので、柱の比較はこれで行う。 */
  profitPerHourYen: number | null;
  openDealCount: number;
  /** 進行中案件の金額合計（円） */
  pipelineYen: number;
  /** 請求済みだが未入金の金額（円） */
  unpaidYen: number;
}

/** 参謀が出す「材料」。判断そのものは書かない。 */
export interface BriefItem {
  headline: string;
  /** 事実（数字・日付） */
  fact: string;
  /** 選べる手。どれを選ぶかは本人が決める。 */
  options: string[];
}

export interface MorningBrief {
  date: string;
  generatedAt: string;
  text: string;
  items: BriefItem[];
  counts: {
    dueToday: number;
    overdue: number;
    stalled: number;
    unpaid: number;
    reviewDuePillars: number;
  };
}

export interface WeeklyReview {
  from: string;
  to: string;
  generatedAt: string;
  text: string;
  summaries: PillarSummary[];
  items: BriefItem[];
}

/* ---------- AI参謀への依頼と、その下書き ---------- */

export type DraftKind = 'reply' | 'estimate' | 'content';

export interface DraftRequest {
  kind: DraftKind;
  /** 何についてか（相手の文面、案件メモ、発信テーマ） */
  input: string;
  /** 案件やお客さんの背景 */
  context?: string;
  pillarKind?: PillarKind;
}

export interface DraftResult {
  kind: DraftKind;
  /** そのまま使える下書き本文 */
  text: string;
  /** 出す前に自分で埋める・確かめる項目 */
  checkBeforeSending: string[];
  /** AIが決めてはいけないので伏せた部分 */
  leftToYou: string[];
}
