import type { AnalyzeRiskResult, Priority } from './types.js';

const includesAny = (text: string, words: string[]) => words.some((word) => text.includes(word));

export function classifyPriority(text: string, risk: AnalyzeRiskResult): Priority {
  const normalized = text.toLowerCase();

  if (
    risk.type === 'none' &&
    includesAny(normalized, ['完了しました', '共有済み', '報告のみ', '対応済み']) &&
    !includesAny(normalized, ['確認お願いします', '至急', '見積', '依頼'])
  ) {
    return 'C';
  }

  if (
    risk.level === 'high' ||
    includesAny(normalized, [
      '社長判断',
      '承認',
      '今日決め',
      '今日中に決',
      '至急',
      '現場が止',
      '作業が止',
      '値引',
      '事故',
      'クレーム',
      '怒って',
      '入金が予定日を過ぎ'
    ])
  ) {
    return 'A';
  }

  if (
    includesAny(normalized, [
      '見積',
      '確認',
      '依頼',
      'お願いします',
      '調整',
      '資料',
      '写真',
      '請求書',
      '日程',
      '手配'
    ])
  ) {
    return 'B';
  }

  return 'C';
}
