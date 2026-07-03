import type { AnalyzeMessageResult, CompanyOperationsTeamReview, TeamRoleReview } from '../../domain/types.js';
import { normalizeText } from '../../utils/textNormalize.js';
import {
  reviewAsBackoffice,
  reviewAsConstruction,
  reviewAsPartner,
  reviewAsPresidentOffice,
  reviewAsRiskOfficer,
  reviewAsSales
} from './roleAgents.js';

const roleLabels: Record<TeamRoleReview['role'], string> = {
  sales: '営業担当',
  construction: '工務担当',
  backoffice: '業務サポート担当',
  partner: '協力会社対応担当',
  risk_officer: 'リスク管理担当',
  president_office: '社長室'
};

function buildTeamSummary(review: Pick<CompanyOperationsTeamReview, 'reviews' | 'leadRole'>): string {
  const relevantReviews = review.reviews.filter((r) => r.relevant);
  if (relevantReviews.length === 0) {
    return '会社運営チーム：担当外事項として記録のみ。';
  }
  const parts = relevantReviews.map((r) => `${roleLabels[r.role]}が${r.recommendation}`);
  return `会社運営チームレビュー：${parts.join(' ')}`;
}

/**
 * 会社運営チーム（役割別AIエージェント）としてメッセージを合議レビューする。
 * analyzeMessageで得た分析結果（リスク・優先度・担当タスク）をもとに、
 * 各役割が自分の専門領域からの推奨対応を出す。外部への自動返信・自動確定は行わない。
 */
export function reviewAsCompanyOperationsTeam(
  analysisInputText: string,
  analysis: AnalyzeMessageResult
): CompanyOperationsTeamReview {
  const text = normalizeText(analysisInputText);
  const { risk, priority } = analysis;

  const reviews: TeamRoleReview[] = [
    reviewAsSales(text, risk, priority),
    reviewAsConstruction(text, risk, priority),
    reviewAsBackoffice(text, risk),
    reviewAsPartner(text, risk, priority),
    reviewAsRiskOfficer(text, risk),
    reviewAsPresidentOffice(text, priority)
  ];

  const leadRole = analysis.tasks[0]?.ownerType ?? 'unknown';

  return {
    leadRole,
    reviews,
    teamSummary: buildTeamSummary({ reviews, leadRole })
  };
}
