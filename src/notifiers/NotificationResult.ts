export interface NotificationResult {
  channel: string;
  sent: boolean;
  dryRun: boolean;
  error?: string;
}
