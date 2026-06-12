import type { RiskLevel, RiskType } from './types.js';

export interface RiskRuleResult {
  type: RiskType;
  level: RiskLevel;
  reason: string;
}

const includesAny = (text: string, words: string[]) => words.some((word) => text.includes(word));

export function detectRisk(text: string): RiskRuleResult {
  const normalized = text.toLowerCase();

  if (includesAny(normalized, ['怒', 'クレーム', '苦情', '至急折り返し', '対応が悪', '不満'])) {
    return {
      type: 'complaint',
      level: 'high',
      reason: 'クレーム化または顧客不満を示す表現があります。'
    };
  }

  if (includesAny(normalized, ['事故', 'ケガ', '怪我', '破損', '損傷', '安全', '労災'])) {
    return {
      type: 'accident',
      level: 'high',
      reason: '事故・破損・安全に関する表現があります。'
    };
  }

  if (includesAny(normalized, ['作業が止ま', '現場が止ま', '着工でき', '止まります', '明日の作業が止'])) {
    return {
      type: 'site_stop',
      level: 'high',
      reason: '現場停止または工程遅延につながる表現があります。'
    };
  }

  if (includesAny(normalized, ['入金', '未入金', '支払予定日', '予定日を過ぎ', '回収', '滞納'])) {
    return {
      type: 'payment_delay',
      level: includesAny(normalized, ['過ぎ', '未入金', '滞納']) ? 'high' : 'medium',
      reason: '入金・回収・支払期日に関する確認が必要です。'
    };
  }

  if (includesAny(normalized, ['人員不足', '人が足り', '応援', '手配でき', '職人が足り'])) {
    return {
      type: 'manpower_shortage',
      level: 'medium',
      reason: '人員不足または手配リスクがあります。'
    };
  }

  if (includesAny(normalized, ['値引', '追加外注', '外注費', '原価', '粗利', '追加費用'])) {
    return {
      type: 'gross_profit',
      level: includesAny(normalized, ['今日決め', '承認', '止ま']) ? 'high' : 'medium',
      reason: '金額・原価・粗利に影響する表現があります。'
    };
  }

  if (includesAny(normalized, ['契約', '条件', '覚書', '請負', '発注書'])) {
    return {
      type: 'contract',
      level: 'medium',
      reason: '契約条件に関わる可能性があります。'
    };
  }

  if (includesAny(normalized, ['退職', '採用', '給与', '残業', '労務', '内定'])) {
    return {
      type: 'labor',
      level: 'medium',
      reason: '採用・退職・労務に関する内容です。'
    };
  }

  if (includesAny(normalized, ['キャンセル', '他社', '相見積', '失注', '今日中に見積', '見積を今日中'])) {
    return {
      type: 'lost_order',
      level: 'low',
      reason: '受注機会または失注リスクに関係する可能性があります。'
    };
  }

  return {
    type: 'none',
    level: 'none',
    reason: '明確なリスク表現は検出されませんでした。'
  };
}
