import type { BusinessLine, LeadStage, LeadTemperature } from './types.js';

const includesAny = (text: string, words: string[]) => words.some((word) => text.includes(word));

/**
 * 事業別の平均受注単価（円）。見込み金額の初期値に使う。
 * 実績が溜まったら実際の平均受注単価へ差し替えること。
 */
export const AVERAGE_ORDER_VALUE_YEN: Record<BusinessLine, number> = {
  construction: 3_000_000,
  demolition: 1_500_000,
  exterior: 1_200_000,
  realestate: 800_000,
  welfare: 400_000,
  unknown: 500_000
};

/**
 * 段階別の受注確度。加重見込み金額の計算に使う。
 * 温度感（hot/warm/cold）で最大±0.1補正する。
 */
export const STAGE_WIN_PROBABILITY: Record<LeadStage, number> = {
  new: 0.1,
  contacted: 0.2,
  estimating: 0.4,
  proposed: 0.6,
  won: 1,
  lost: 0,
  nurturing: 0.05
};

/** 温度感別の追客間隔（日）。冷たいリードほど間隔を空ける。 */
export const FOLLOW_UP_INTERVAL_DAYS: Record<LeadTemperature, number> = {
  hot: 1,
  warm: 3,
  cold: 7
};

/** 追客タスクの自動生成上限。これを超えたらnurturingへ落として自動追客を止める。 */
export const MAX_FOLLOW_UP_COUNT = 5;

/** これ以上の見込み金額は社長判断を促す（円） */
export const PRESIDENT_REVIEW_VALUE_YEN = 3_000_000;

/** SNSへの返信は社外向けのため、必ず人の確認を挟む。下書きのngReasonsに必ず残す。 */
export const SNS_REPLY_HUMAN_CHECK_REASON =
  'SNSの公開・DM返信は社外向けのため、送信前に必ず人が確認してください。';

const BUSINESS_LINE_KEYWORDS: Array<{ line: BusinessLine; words: string[] }> = [
  { line: 'demolition', words: ['解体', '取り壊し', '取壊し', '更地', '空き家', 'アスベスト', '残置物'] },
  { line: 'exterior', words: ['外構', 'エクステリア', '駐車場', 'カーポート', 'ブロック塀', 'フェンス', '土間', '造成', '庭'] },
  { line: 'realestate', words: ['売却', '購入', '賃貸', '入居', '退去', '空室', '物件', '土地', '仲介', '管理費'] },
  { line: 'welfare', words: ['介護', '福祉', 'デイサービス', '施設', '利用者', 'ケア', 'グループホーム'] },
  {
    line: 'construction',
    words: ['新築', 'リフォーム', '改修', '増築', '内装', '塗装', '屋根', '基礎', '工事', '施工']
  }
];

/** 本文から対象事業を判定する。解体・外構を建設より先に見る（より具体的なため）。 */
export function detectBusinessLine(text: string): BusinessLine {
  for (const { line, words } of BUSINESS_LINE_KEYWORDS) {
    if (includesAny(text, words)) return line;
  }
  return 'unknown';
}

/** 受注につながる発言（強いシグナルほど配点が高い） */
const BUYING_SIGNALS: Array<{ words: string[]; label: string; score: number }> = [
  { words: ['見積', '御見積', 'お見積'], label: '見積依頼', score: 30 },
  { words: ['いくら', '費用', '料金', '価格', '相場', '予算'], label: '金額の質問', score: 20 },
  { words: ['依頼したい', 'お願いしたい', '頼みたい', '発注', '契約'], label: '依頼意思', score: 30 },
  { words: ['来てほしい', '現地', '下見', '訪問', '見に来'], label: '現地調査の希望', score: 25 },
  { words: ['今月', '来月', '今週', '来週', '急い', 'すぐ', '至急', '日程', 'いつ空'], label: '時期の明示', score: 20 },
  { words: ['電話', '連絡先', 'メール', '折り返し', '番号'], label: '連絡手段の提示', score: 15 },
  { words: ['他社', '相見積', '比較'], label: '他社検討中', score: 15 }
];

/** 返信前に埋めたい情報 */
const MISSING_INFO_CHECKS: Array<{ label: string; words: string[] }> = [
  { label: '対象の住所・地域', words: ['市', '町', '区', '丁目', '番地', '県'] },
  { label: '希望時期', words: ['今月', '来月', '今週', '来週', '月', '日', 'いつ'] },
  { label: '現場の規模（坪数・面積・階数）', words: ['坪', '平米', '㎡', 'm2', '階建', '平屋', '棟'] },
  { label: '連絡先（電話またはメール）', words: ['電話', '090', '080', '070', '@', 'メール'] },
  { label: '予算感', words: ['予算', '万円', '円まで'] }
];

/** 業務の反響ではない売り込み・迷惑DMの特徴 */
const SPAM_KEYWORDS = [
  '相互フォロー',
  'フォロバ',
  'アフィリエイト',
  '副業',
  '投資',
  '暗号資産',
  '仮想通貨',
  'FX',
  'SEO対策',
  '集客支援',
  '広告運用代行',
  'インフルエンサー',
  '出会い',
  'LINEに登録',
  '稼げ',
  '月収'
];

export interface LeadScoreResult {
  score: number;
  temperature: LeadTemperature;
  buyingSignals: string[];
  missingInfo: string[];
}

/**
 * 反響本文から受注確度（0〜100）と温度感を出す。
 * hot=当日中に一次返信、warm=翌営業日まで、cold=定期フォロー。
 */
export function scoreLead(text: string): LeadScoreResult {
  let score = 0;
  const buyingSignals: string[] = [];

  for (const signal of BUYING_SIGNALS) {
    if (includesAny(text, signal.words)) {
      score += signal.score;
      buyingSignals.push(signal.label);
    }
  }

  // 具体的な規模の記載は本気度が高い
  if (/\d+\s*(坪|平米|㎡|m2|棟|台)/.test(text)) {
    score += 10;
    buyingSignals.push('規模の具体的な記載');
  }

  // 一言コメントは温度が低い
  if (text.length < 15 && buyingSignals.length === 0) {
    score -= 10;
  }

  const missingInfo = MISSING_INFO_CHECKS.filter((check) => !includesAny(text, check.words)).map(
    (check) => check.label
  );

  const bounded = Math.max(0, Math.min(100, score));
  const temperature: LeadTemperature = bounded >= 70 ? 'hot' : bounded >= 40 ? 'warm' : 'cold';

  return { score: bounded, temperature, buyingSignals, missingInfo };
}

export interface SpamCheckResult {
  isSpam: boolean;
  reason: string;
}

/** 売り込みDMを弾く。業務ワードが含まれる場合は反響として残す（誤判定を避ける）。 */
export function detectInquirySpam(text: string): SpamCheckResult {
  const hit = SPAM_KEYWORDS.find((word) => text.includes(word));
  if (!hit) return { isSpam: false, reason: '' };

  const hasBusinessContext = detectBusinessLine(text) !== 'unknown' || text.includes('見積');
  if (hasBusinessContext) {
    return { isSpam: false, reason: '' };
  }

  return { isSpam: true, reason: `売り込みDMの特徴（「${hit}」）が含まれています。` };
}

/**
 * 見込み金額（円）を概算する。事業別の平均受注単価に規模の係数を掛けるだけの粗い推定。
 * 本文に金額の記載があればそれを優先する。
 */
export function estimateLeadValueYen(businessLine: BusinessLine, text: string): number | null {
  const explicit = text.match(/(\d{1,5})\s*万円/);
  if (explicit) {
    return Number(explicit[1]) * 10_000;
  }

  const base = AVERAGE_ORDER_VALUE_YEN[businessLine];
  if (businessLine === 'unknown' && !includesAny(text, ['見積', '費用', '工事', '依頼'])) {
    return null;
  }

  let factor = 1;
  const tsubo = text.match(/(\d{1,4})\s*坪/);
  const squareMeter = text.match(/(\d{1,5})\s*(平米|㎡|m2)/);
  if (tsubo) {
    factor = Number(tsubo[1]) / 40;
  } else if (squareMeter) {
    factor = Number(squareMeter[1]) / 132;
  } else if (includesAny(text, ['大型', '複数棟', 'マンション', 'ビル', '工場', '倉庫'])) {
    factor = 2.5;
  } else if (includesAny(text, ['小さい', '一部', '部分的', '物置', '小屋'])) {
    factor = 0.4;
  }

  const bounded = Math.max(0.2, Math.min(10, factor));
  return Math.round((base * bounded) / 10_000) * 10_000;
}

/** 段階と温度感から受注確度を出す。加重パイプライン金額に使う。 */
export function winProbability(stage: LeadStage, temperature: LeadTemperature): number {
  const base = STAGE_WIN_PROBABILITY[stage];
  if (stage === 'won' || stage === 'lost') return base;
  const adjust = temperature === 'hot' ? 0.1 : temperature === 'cold' ? -0.05 : 0;
  return Math.max(0, Math.min(1, base + adjust));
}

/** 進行中（受注も失注もしていない）リードかどうか */
export function isOpenLeadStage(stage: LeadStage): boolean {
  return stage !== 'won' && stage !== 'lost';
}

export const BUSINESS_LINE_LABELS: Record<BusinessLine, string> = {
  construction: '建設',
  demolition: '解体',
  exterior: '外構',
  realestate: '不動産',
  welfare: '福祉',
  unknown: '未分類'
};

/** 投稿本文で使う事業の呼び方。「不動産工事」のような不自然な表記を避ける。 */
export const BUSINESS_LINE_WORK_LABELS: Record<BusinessLine, string> = {
  construction: '建設工事',
  demolition: '解体工事',
  exterior: '外構工事',
  realestate: '不動産',
  welfare: '福祉事業',
  unknown: '施工'
};

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  new: '新規',
  contacted: '一次返信済',
  estimating: '見積作成中',
  proposed: '提案済',
  won: '受注',
  lost: '失注',
  nurturing: '長期フォロー'
};
