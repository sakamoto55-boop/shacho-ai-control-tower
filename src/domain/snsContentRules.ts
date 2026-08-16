import { dayOfWeekIso, shiftIsoDate } from '../utils/date.js';
import type { BusinessLine, SnsChannel, SnsPostGenerationInput, SnsPostPurpose } from './types.js';

export interface WeeklyTheme {
  /** 0=日曜 */
  dayOfWeek: number;
  purpose: SnsPostPurpose;
  theme: string;
  /** 投稿に向く時間帯（HH:mm） */
  scheduledTime: string;
}

/**
 * 曜日ごとの投稿テーマ。
 * 平日は集客導線と信頼構築を交互に置き、土曜に相談導線、日曜に採用・会社の日常を置く。
 */
export const WEEKLY_THEMES: WeeklyTheme[] = [
  { dayOfWeek: 1, purpose: 'case_study', theme: '完了した現場の作業内容と工期', scheduledTime: '07:30' },
  { dayOfWeek: 2, purpose: 'trust_building', theme: 'ビフォーアフター写真の比較', scheduledTime: '12:15' },
  { dayOfWeek: 3, purpose: 'lead_generation', theme: '費用の目安と内訳の考え方', scheduledTime: '19:00' },
  { dayOfWeek: 4, purpose: 'trust_building', theme: 'よくいただく質問への回答', scheduledTime: '12:15' },
  { dayOfWeek: 5, purpose: 'case_study', theme: '現場の安全対策と近隣への配慮', scheduledTime: '19:00' },
  { dayOfWeek: 6, purpose: 'lead_generation', theme: '無料相談・現地調査のご案内', scheduledTime: '10:00' },
  { dayOfWeek: 0, purpose: 'recruiting', theme: '社員紹介と働く環境', scheduledTime: '11:00' }
];

/**
 * 事業のローテーション。同じ事業ばかり続けず、5事業を順に露出させる。
 */
export const BUSINESS_LINE_ROTATION: BusinessLine[] = [
  'demolition',
  'exterior',
  'construction',
  'realestate',
  'welfare'
];

/** チャンネル別の投稿本文の長さ目安（文字数） */
export const CHANNEL_BODY_LIMIT: Record<SnsChannel, number> = {
  instagram: 500,
  x: 130,
  youtube: 400,
  tiktok: 150,
  facebook: 600,
  google_business: 700,
  web_form: 500
};

/**
 * 景表法（優良誤認・有利誤認）や誇大広告に当たりうる表現。
 * 検出したら投稿下書きに理由を残し、人が直すまで承認できないようにする。
 */
const AD_COMPLIANCE_NG_WORDS: Array<{ word: string; reason: string }> = [
  { word: '必ず', reason: '断定表現（「必ず」）は優良誤認のおそれがあります。' },
  { word: '絶対', reason: '断定表現（「絶対」）は優良誤認のおそれがあります。' },
  { word: '100%', reason: '断定表現（「100%」）は優良誤認のおそれがあります。' },
  { word: '完全に', reason: '断定表現（「完全に」）は優良誤認のおそれがあります。' },
  { word: '日本一', reason: '最上級表現（「日本一」）は根拠資料がなければ使えません。' },
  { word: '業界No.1', reason: '最上級表現（「業界No.1」）は根拠資料がなければ使えません。' },
  { word: '地域No.1', reason: '最上級表現（「地域No.1」）は根拠資料がなければ使えません。' },
  { word: '最安', reason: '最安値表現は有利誤認のおそれがあります。' },
  { word: '業界最安値', reason: '最安値表現は有利誤認のおそれがあります。' },
  { word: '格安', reason: '価格訴求は条件の明示が必要です。' },
  { word: '無料保証', reason: '保証内容を明示しない保証表現は使えません。' },
  { word: '一切かかりません', reason: '費用ゼロの断定は条件の明示が必要です。' }
];

/** 投稿本文に価格を断定していないか、誇大表現がないかを確認する。 */
export function checkAdCompliance(text: string): string[] {
  const reasons = AD_COMPLIANCE_NG_WORDS.filter((ng) => text.includes(ng.word)).map((ng) => ng.reason);

  // 「〇〇円で対応します」のような価格の言い切りは、条件次第で有利誤認になる
  if (/\d+\s*(万円|円)(で|から)(対応|施工|やります|できます)/.test(text)) {
    reasons.push('価格の言い切りは条件（面積・立地・処分費）の明示が必要です。');
  }

  return reasons;
}

export interface SnsPostPlanOptions {
  /** 起点日（YYYY-MM-DD） */
  fromDate: string;
  /** 生成する日数 */
  days: number;
  /** 投稿先。省略時はinstagramとgoogle_business。 */
  channels?: SnsChannel[];
  /** 商圏。本文に地域名を入れるために使う。 */
  area?: string;
  /** 投稿に織り込む素材（実績値など） */
  highlights?: string[];
}

/**
 * 指定日数分の投稿カレンダーを組む。
 * 曜日テーマ×事業ローテーションで、同じ内容が続かないように割り当てる。
 */
export function buildSnsPostPlan(options: SnsPostPlanOptions): SnsPostGenerationInput[] {
  const channels = options.channels?.length ? options.channels : (['instagram', 'google_business'] as SnsChannel[]);
  const days = Math.max(1, Math.min(60, options.days));
  const plan: SnsPostGenerationInput[] = [];

  for (let offset = 0; offset < days; offset += 1) {
    const scheduledDate = shiftIsoDate(options.fromDate, offset);
    const dow = dayOfWeekIso(scheduledDate);
    const weekly = WEEKLY_THEMES.find((item) => item.dayOfWeek === dow) ?? WEEKLY_THEMES[0];

    channels.forEach((channel, channelIndex) => {
      const businessLine =
        BUSINESS_LINE_ROTATION[(offset + channelIndex) % BUSINESS_LINE_ROTATION.length];
      plan.push({
        channel,
        scheduledDate,
        scheduledTime: weekly.scheduledTime,
        businessLine,
        purpose: weekly.purpose,
        theme: weekly.theme,
        area: options.area,
        highlights: options.highlights
      });
    });
  }

  return plan;
}
