import type { DailyReport } from '../domain/types.js';

export function formatLineworksReport(report: DailyReport): string {
  return report.text;
}
