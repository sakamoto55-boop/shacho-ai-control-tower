import { createLineworksConnector } from '../connectors/lineworks.js';
import type { DailyReport } from '../domain/types.js';
import type { Repository } from '../repositories/Repository.js';
import { generateDailyReport, type ReportKind } from '../reports/generateDailyReport.js';

export async function generateAndSendReport(
  repository: Repository,
  kind: ReportKind
): Promise<DailyReport> {
  const report = await generateDailyReport(repository, kind);
  await createLineworksConnector().sendReport(report.text);
  return report;
}
