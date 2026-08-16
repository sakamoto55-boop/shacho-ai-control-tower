import { createLineworksConnector } from '../connectors/lineworks.js';
import type { DailyReport, RevenueReport } from '../domain/types.js';
import type { Repository } from '../repositories/Repository.js';
import { generateDailyReport, type ReportKind } from '../reports/generateDailyReport.js';
import { generateRevenueReport } from '../reports/generateRevenueReport.js';

export async function generateAndSendReport(
  repository: Repository,
  kind: ReportKind
): Promise<DailyReport> {
  const report = await generateDailyReport(repository, kind);
  await createLineworksConnector().sendReport(report.text);
  return report;
}

export async function generateAndSendRevenueReport(repository: Repository): Promise<RevenueReport> {
  const report = await generateRevenueReport(repository);
  await createLineworksConnector().sendReport(report.text);
  return report;
}
