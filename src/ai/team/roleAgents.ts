import type { AnalyzeRiskResult, Confidence, Priority, TeamRoleReview } from '../../domain/types.js';

function confidenceFor(relevant: boolean, hitCount: number): Confidence {
  if (!relevant) return 'low';
  return hitCount >= 2 ? 'high' : 'medium';
}

/**
 * 営業チーム担当エージェント。見積・受注・失注に関する連絡を評価する。
 */
export function reviewAsSales(text: string, risk: AnalyzeRiskResult, priority: Priority): TeamRoleReview {
  const words = ['見積', '受注', '顧客', '営業', '相見積', '失注', '契約'];
  const hits = words.filter((word) => text.includes(word));
  const relevant = hits.length > 0;
  return {
    role: 'sales',
    relevant,
    recommendation: relevant
      ? '見積・受注状況を確認し、まず予算感と競合有無を整理する。金額提示は社長確認後に行う。'
      : '営業対応の対象事項は見当たりません。',
    requiresPresident: relevant && (risk.type === 'lost_order' || priority === 'A'),
    confidence: confidenceFor(relevant, hits.length)
  };
}

/**
 * 工務チーム担当エージェント。現場・工程・人員に関する連絡を評価する。
 */
export function reviewAsConstruction(text: string, risk: AnalyzeRiskResult, priority: Priority): TeamRoleReview {
  const words = ['現場', '作業', '工務', '職人', '人員', '外注', '写真', '配置', '資材', '工期'];
  const hits = words.filter((word) => text.includes(word));
  const relevant = hits.length > 0;
  return {
    role: 'construction',
    relevant,
    recommendation: relevant
      ? '工程・人員・資材の手配状況を確認する。現場停止や人員不足につながる場合は社長へ即報告する。'
      : '工務対応の対象事項は見当たりません。',
    requiresPresident: relevant && (risk.type === 'site_stop' || risk.type === 'manpower_shortage' || priority === 'A'),
    confidence: confidenceFor(relevant, hits.length)
  };
}

/**
 * 業務サポート（経理・バックオフィス）担当エージェント。入金・請求・支払を評価する。
 */
export function reviewAsBackoffice(text: string, risk: AnalyzeRiskResult): TeamRoleReview {
  const words = ['請求', '入金', '支払', '経理', '書類', '請求書', '振込'];
  const hits = words.filter((word) => text.includes(word));
  const relevant = hits.length > 0;
  return {
    role: 'backoffice',
    relevant,
    recommendation: relevant
      ? '入金・請求内容を予定と照合する。督促文面の自動送信はせず、事実確認のみ行う。'
      : '経理・バックオフィス対応の対象事項は見当たりません。',
    requiresPresident: relevant && (risk.type === 'payment_delay' && risk.level === 'high'),
    confidence: confidenceFor(relevant, hits.length)
  };
}

/**
 * 協力会社対応担当エージェント。外注先・応援手配に関する連絡を評価する。
 */
export function reviewAsPartner(text: string, risk: AnalyzeRiskResult, priority: Priority): TeamRoleReview {
  const words = ['協力会社', '外注先', '応援', '業者'];
  const hits = words.filter((word) => text.includes(word));
  const relevant = hits.length > 0;
  return {
    role: 'partner',
    relevant,
    recommendation: relevant
      ? '対応可否・必要人数・希望時間・費用条件を確認する。費用条件の確定は社長確認後に行う。'
      : '協力会社対応の対象事項は見当たりません。',
    requiresPresident: relevant && (risk.type === 'gross_profit' || priority === 'A'),
    confidence: confidenceFor(relevant, hits.length)
  };
}

/**
 * リスク管理担当エージェント。全メッセージに目を通し、自動確定してはいけない事項を洗い出す。
 * 金額、契約、納期、謝罪、責任認定、外注費、労務、事故は必ず人間（社長）確認とする。
 */
export function reviewAsRiskOfficer(text: string, risk: AnalyzeRiskResult): TeamRoleReview {
  const dangerousWords = ['金額', '値引', '契約', '納期', '謝罪', '外注費', '労務', '事故', '責任'];
  const hits = dangerousWords.filter((word) => text.includes(word));
  const relevant = risk.type !== 'none' || hits.length > 0;
  return {
    role: 'risk_officer',
    relevant,
    recommendation: relevant
      ? `${risk.reason} 自動確定は行わず、必ず人間の確認を経てから対応すること。`
      : '明確なリスクは検出されていません。',
    requiresPresident: risk.level === 'high',
    confidence: confidenceFor(relevant, hits.length)
  };
}

/**
 * 社長室（エスカレーション）担当エージェント。社長判断が必要な事項を評価する。
 */
export function reviewAsPresidentOffice(text: string, priority: Priority): TeamRoleReview {
  const words = ['社長', '承認', '値引', '契約条件', '今日決め', '社長確認'];
  const hits = words.filter((word) => text.includes(word));
  const relevant = priority === 'A' || hits.length > 0;
  return {
    role: 'president_office',
    relevant,
    recommendation: relevant
      ? '社長判断が必要な事項として即時エスカレーションする。'
      : '社長判断が必要な事項は見当たりません。',
    requiresPresident: relevant,
    confidence: confidenceFor(relevant, hits.length)
  };
}
