/**
 * Audit Log。誰が・いつ・何を・どのスコープで実行したかを記録する。
 * Phase Aはメモリ内リングバッファ＋任意のJSONLファイル追記。
 * 機微情報はmaskSensitiveでマスクしてから記録する。
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { maskSensitive } from './security.js';

export interface AuditEntry {
  timestamp: string;
  actor: string;
  role: string;
  action: string;
  scope: string;
  detail: string;
  outcome: 'ok' | 'denied' | 'error';
}

const MAX_ENTRIES = 1000;

export class AuditLog {
  private readonly entries: AuditEntry[] = [];
  private readonly filePath: string | null;

  constructor(filePath = process.env.LCC_COMMAND_AUDIT_FILE ?? '') {
    this.filePath = filePath ? resolve(filePath) : null;
  }

  async record(
    entry: Omit<AuditEntry, 'timestamp' | 'detail'> & { detail: string }
  ): Promise<void> {
    const masked: AuditEntry = {
      ...entry,
      detail: maskSensitive(entry.detail).slice(0, 500),
      timestamp: new Date().toISOString()
    };
    this.entries.push(masked);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
    if (this.filePath) {
      try {
        await mkdir(dirname(this.filePath), { recursive: true });
        await appendFile(this.filePath, `${JSON.stringify(masked)}\n`, 'utf8');
      } catch {
        // 監査ファイル書き込み失敗でAPI自体は止めない（メモリ側には残る）
      }
    }
  }

  recent(limit = 50): AuditEntry[] {
    return this.entries.slice(-limit);
  }
}
