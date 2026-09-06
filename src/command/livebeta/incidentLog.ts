import { randomUUID as persistentUuid } from 'node:crypto';
/**
 * Beta Incident Log（LIVE BETA §19）。
 *
 * 実運用中の誤回答・誤検索・誤Memory・誤Routing・UI問題・遅延・Provider障害を
 * Incidentとして記録し、再発防止をGrowth Pipeline（Backlog候補）へ接続する。
 * - Incidentは削除しない（状態遷移のみ: OPEN→ANALYZED→RESOLVED）
 * - 会話本文・機微情報は保存しない（説明は短く、必要ならIDで参照）
 * - 同種Incidentが閾値（3件）以上でGrowth候補化する（単発と繰り返しを区別 §5）
 */
import type { Evidence, Principal } from '../domain/types.js';
import type { CommandRepository } from '../repositories/CommandRepository.js';
import { GrowthService, type GrowthCandidate } from '../growth/growthBacklog.js';

export type IncidentKind =
  | 'WRONG_ANSWER' // 誤回答
  | 'WRONG_SEARCH' // 誤検索
  | 'WRONG_MEMORY' // 誤Memory
  | 'WRONG_ROUTING' // 誤Routing
  | 'UI' // UI問題
  | 'LATENCY' // 遅延
  | 'PROVIDER_OUTAGE'; // Provider障害

export type IncidentStatus = 'OPEN' | 'ANALYZED' | 'RESOLVED';

export interface IncidentRecord {
  incidentId: string;
  kind: IncidentKind;
  /** 短い説明（会話本文・機微情報を含めない） */
  description: string;
  sessionId?: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  status: IncidentStatus;
  reportedBy: string;
  evidence: Evidence[];
  resolutionNote?: string;
  createdAt: string;
  updatedAt: string;
}

export const INCIDENT_KIND_LABELS: Record<IncidentKind, string> = {
  WRONG_ANSWER: '誤回答',
  WRONG_SEARCH: '誤検索',
  WRONG_MEMORY: '誤Memory',
  WRONG_ROUTING: '誤Routing',
  UI: 'UI問題',
  LATENCY: '遅延',
  PROVIDER_OUTAGE: 'Provider障害'
};

let incidentSeq = 0;
export function resetIncidentSeq(): void {
  incidentSeq = 0;
}

export class IncidentService {
  private readonly growth: GrowthService;

  constructor(private readonly repository: CommandRepository) {
    this.growth = new GrowthService(repository);
  }

  async list(): Promise<IncidentRecord[]> {
    return this.repository.getIncidents();
  }

  async report(
    input: Pick<IncidentRecord, 'kind' | 'description' | 'severity'> &
      Partial<Pick<IncidentRecord, 'sessionId' | 'evidence'>>,
    principal: Principal,
    now: string
  ): Promise<{ incident: IncidentRecord; growthCandidate: GrowthCandidate | null }> {
    incidentSeq += 1;
    const incident: IncidentRecord = {
      incidentId: `inc-${String(incidentSeq).padStart(3, '0')}-${persistentUuid()}`,
      kind: input.kind,
      description: input.description.slice(0, 200),
      sessionId: input.sessionId,
      severity: input.severity,
      status: 'OPEN',
      reportedBy: principal.label,
      evidence: input.evidence ?? [],
      createdAt: now,
      updatedAt: now
    };
    await this.repository.saveIncident(incident);

    // §19: 同種Incidentが3件以上=繰り返し問題 → Growth Backlog候補化（再発防止）
    const sameKind = (await this.list()).filter((i) => i.kind === incident.kind);
    let growthCandidate: GrowthCandidate | null = null;
    if (sameKind.length >= 3 && sameKind.length % 3 === 0) {
      try {
        growthCandidate = await this.growth.addCandidate(
          {
            domain: 'AI',
            title: `${INCIDENT_KIND_LABELS[incident.kind]}の再発防止（${sameKind.length}件発生）`,
            problem: `Incident「${INCIDENT_KIND_LABELS[incident.kind]}」が${sameKind.length}件繰り返し発生しています（単発異常ではなく構造的問題の可能性）`,
            source: 'INCIDENT',
            risk: 'LOW',
            evidence: [
              {
                label: 'Incident件数',
                value: `${INCIDENT_KIND_LABELS[incident.kind]} ${sameKind.length}件`,
                source: 'Beta Incident Log（決定論集計）',
                asOf: now.slice(0, 10)
              }
            ],
            priorityInput: {
              impact: 0.6,
              urgency: 0.6,
              confidence: 0.7,
              effort: 0.4,
              risk: 0.1,
              goalAlignment: 0.5
            }
          },
          now
        );
      } catch {
        // Growth候補化の失敗でIncident記録を止めない
      }
    }
    return { incident, growthCandidate };
  }

  /** 状態遷移のみ（削除しない）。解決時はresolutionNoteを残す */
  async transition(
    incidentId: string,
    status: IncidentStatus,
    now: string,
    resolutionNote?: string
  ): Promise<IncidentRecord | null> {
    const incidents = await this.list();
    const target = incidents.find((i) => i.incidentId === incidentId);
    if (!target) return null;
    const updated: IncidentRecord = {
      ...target,
      status,
      resolutionNote: resolutionNote ?? target.resolutionNote,
      updatedAt: now
    };
    await this.repository.saveIncident(updated);
    return updated;
  }

  /** 種類別集計（Autonomy Review・Weekly Reviewで使用） */
  async summarize(): Promise<Array<{ kind: IncidentKind; total: number; open: number }>> {
    const incidents = await this.list();
    const kinds = [...new Set(incidents.map((i) => i.kind))];
    return kinds.map((kind) => ({
      kind,
      total: incidents.filter((i) => i.kind === kind).length,
      open: incidents.filter((i) => i.kind === kind && i.status === 'OPEN').length
    }));
  }
}
