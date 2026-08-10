/**
 * Observability / Cost記録（Phase B1 §19-§21）。
 *
 * - 会話1件ごとのメタデータ（intent・使用Tool・確信度・所要時間）を記録する。
 * - 回答へのフィードバック（良い/悪い）も同じログへ保存する（モデルの自動学習には使わない）。
 * - 機微情報の一括記録はしない: 会話本文は保存せず、コメントはマスクして短く保持する。
 * - メモリ内リングバッファ + 任意のJSONLファイル追記（LCC_COMMAND_OBS_FILE）。
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { maskSensitive } from '../security/security.js';

export interface ObservabilityEntry {
  timestamp: string;
  kind: 'chat' | 'feedback' | 'llm_call' | 'llm_incident';
  sessionId?: string;
  scope?: string;
  actor?: string;
  intent?: string;
  toolsUsed?: string[];
  confidence?: string;
  dataStatus?: string;
  durationMs?: number;
  /** llm_call用: プロバイダ名と概算トークン（Cost監視） */
  provider?: string;
  approxTokens?: number;
  /** feedback用 */
  rating?: 'good' | 'bad';
  comment?: string;
  /** llm_incident用（是正⑦）: Provider障害の診断。APIキー・会話本文は入れない */
  providerStatus?: string;
  reasonCode?: string;
  retryable?: boolean;
}

const MAX_ENTRIES = 2000;

export class ObservabilityLog {
  private readonly entries: ObservabilityEntry[] = [];
  private readonly filePath: string | null;

  constructor(filePath = process.env.LCC_COMMAND_OBS_FILE ?? '') {
    this.filePath = filePath ? resolve(filePath) : null;
  }

  async record(entry: Omit<ObservabilityEntry, 'timestamp'>): Promise<void> {
    const sanitized: ObservabilityEntry = {
      ...entry,
      comment: entry.comment ? maskSensitive(entry.comment).slice(0, 300) : undefined,
      timestamp: new Date().toISOString()
    };
    this.entries.push(sanitized);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
    if (this.filePath) {
      try {
        await mkdir(dirname(this.filePath), { recursive: true });
        await appendFile(this.filePath, `${JSON.stringify(sanitized)}\n`, 'utf8');
      } catch {
        // 記録失敗で会話・APIを止めない（メモリ側には残る）
      }
    }
  }

  recent(limit = 50, kind?: ObservabilityEntry['kind']): ObservabilityEntry[] {
    const filtered = kind ? this.entries.filter((e) => e.kind === kind) : this.entries;
    return filtered.slice(-limit);
  }

  /** Cost監視: llm_callの概算トークン合計 */
  totalApproxTokens(): number {
    return this.entries
      .filter((e) => e.kind === 'llm_call')
      .reduce((sum, e) => sum + (e.approxTokens ?? 0), 0);
  }
}
