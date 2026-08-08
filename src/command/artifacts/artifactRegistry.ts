/**
 * Artifact Registry / Artifact Creation Orchestration（Phase X §19-§22・§35-§36）。
 *
 * 生成成果物（資料・画像・Excel・プレゼン・コード等）を正本管理する。
 * - 成果物が会社データを使った場合、どのデータ・資料・Memoryを基にしたかを保持（§22）
 * - 「資料作って」は単一LLM回答にせず、Capability連鎖のPlanとして構成する（§19）
 * - 大型生成は同期チャットをブロックしないTask（QUEUED〜）として扱う（§36）
 * - 成果物を作ること自体を成功としない: 目的/KPI/結果を追跡できる構造（§44）
 */
import type { Evidence } from '../domain/types.js';
import type { CommandRepository } from '../repositories/CommandRepository.js';
import type { CapabilityId } from '../capabilities/capabilityRegistry.js';

export type ArtifactType =
  | 'TEXT'
  | 'DOCX'
  | 'PDF'
  | 'XLSX'
  | 'PPTX'
  | 'IMAGE'
  | 'DIAGRAM'
  | 'CHART'
  | 'HTML'
  | 'CODE'
  | 'ZIP';

export type ArtifactStatus = 'PLANNED' | 'QUEUED' | 'RUNNING' | 'WAITING_INPUT' | 'COMPLETED' | 'FAILED' | 'SUPERSEDED';

export interface ArtifactRecord {
  artifactId: string;
  type: ArtifactType;
  title: string;
  createdAt: string;
  createdBy: string;
  /** 利用した社内データの参照（§22。実値の複製ではなく参照） */
  sourceData: string[];
  sourceEvidence: Evidence[];
  /** 参照したMemory ID */
  sourceMemoryIds: string[];
  version: number;
  status: ArtifactStatus;
  storageLocation?: string;
  relatedProject?: string;
  relatedConversation?: string;
  supersedes?: string;
  /** Result-to-Outcome（§44）: 目的とKPI。作って終わりにしない */
  purpose?: string;
  outcomeKpi?: string;
  outcomeResult?: string;
}

export interface ArtifactPlanStep {
  step: number;
  capability: CapabilityId;
  description: string;
}

export interface ArtifactPlan {
  artifactType: ArtifactType;
  title: string;
  steps: ArtifactPlanStep[];
  /** 実行可否（生成系Provider未接続ならfalse。正直に伝える） */
  executable: boolean;
  blockedBy: string[];
}

let artifactSeq = 0;
export function resetArtifactSeq(): void {
  artifactSeq = 0;
}

/** 依頼種別→Capability連鎖のPlan（§19）。会社データ検索を必ず先頭に置く */
export function planArtifactCreation(
  artifactType: ArtifactType,
  title: string,
  options: { executableCapabilities: Set<CapabilityId> }
): ArtifactPlan {
  const chains: Partial<Record<ArtifactType, Array<{ capability: CapabilityId; description: string }>>> = {
    PPTX: [
      { capability: 'SEARCH_INTERNAL', description: '社内データ・関連資料の収集' },
      { capability: 'DATA_ANALYSIS', description: '数値の決定論集計（AIに暗算させない）' },
      { capability: 'SUMMARIZATION', description: '構成・要点の整理' },
      { capability: 'CHART_GENERATION', description: 'チャート生成' },
      { capability: 'PRESENTATION_CREATION', description: 'スライド生成' }
    ],
    XLSX: [
      { capability: 'SEARCH_INTERNAL', description: '既存正本・既存帳票の確認（新規台帳の乱立防止）' },
      { capability: 'DATA_ANALYSIS', description: 'スキーマ・数式・検証ルールの設計' },
      { capability: 'SPREADSHEET_CREATION', description: 'ワークブック生成' }
    ],
    DOCX: [
      { capability: 'SEARCH_INTERNAL', description: '関連データ・過去資料の収集' },
      { capability: 'WRITING', description: '本文作成（事実と提案を分離）' },
      { capability: 'DOCUMENT_CREATION', description: '文書生成' }
    ],
    PDF: [
      { capability: 'SEARCH_INTERNAL', description: '関連データの収集' },
      { capability: 'WRITING', description: '本文作成' },
      { capability: 'PDF_CREATION', description: 'PDF生成' }
    ],
    IMAGE: [
      { capability: 'SEARCH_INTERNAL', description: '題材・トーンの確認' },
      { capability: 'WRITING', description: 'プロンプト・コピー作成' },
      { capability: 'IMAGE_GENERATION', description: '画像生成（Prompt/Sourceを記録）' }
    ],
    DIAGRAM: [
      { capability: 'SEARCH_INTERNAL', description: '対象構造の確認' },
      { capability: 'DIAGRAM_GENERATION', description: '図の生成' }
    ],
    CHART: [
      { capability: 'DATA_ANALYSIS', description: '決定論集計' },
      { capability: 'CHART_GENERATION', description: 'チャート生成' }
    ],
    CODE: [
      { capability: 'SEARCH_INTERNAL', description: '既存システム・重複の確認（乱立防止）' },
      { capability: 'SOFTWARE_ENGINEERING', description: '設計・実装' }
    ]
  };
  const chain = chains[artifactType] ?? [
    { capability: 'SEARCH_INTERNAL', description: '関連データの収集' },
    { capability: 'WRITING', description: '内容作成' }
  ];
  const withCritic = [...chain, { capability: 'CRITIC_REVIEW' as CapabilityId, description: '検証（数値根拠・原則適合）' }];
  const blockedBy = withCritic
    .filter((s) => !options.executableCapabilities.has(s.capability))
    .map((s) => s.capability);
  return {
    artifactType,
    title,
    steps: withCritic.map((s, i) => ({ step: i + 1, ...s })),
    executable: blockedBy.length === 0,
    blockedBy
  };
}

export class ArtifactService {
  constructor(private readonly repository: CommandRepository) {}

  async register(
    input: Omit<ArtifactRecord, 'artifactId' | 'version' | 'createdAt'> & { createdAt?: string },
    now: string
  ): Promise<ArtifactRecord> {
    artifactSeq += 1;
    const record: ArtifactRecord = {
      version: 1,
      ...input,
      artifactId: `art-${now.slice(0, 10)}-${String(artifactSeq).padStart(3, '0')}`,
      createdAt: input.createdAt ?? now
    };
    await this.repository.saveArtifact(record);
    return record;
  }

  /** 新版登録: 旧版はSUPERSEDEDにして履歴を残す */
  async supersede(oldArtifactId: string, next: ArtifactRecord, now: string): Promise<ArtifactRecord> {
    const all = await this.repository.getArtifacts();
    const old = all.find((a) => a.artifactId === oldArtifactId);
    if (old) await this.repository.saveArtifact({ ...old, status: 'SUPERSEDED' });
    const record: ArtifactRecord = {
      ...next,
      version: (old?.version ?? 0) + 1,
      supersedes: oldArtifactId,
      createdAt: now
    };
    await this.repository.saveArtifact(record);
    return record;
  }

  async list(): Promise<ArtifactRecord[]> {
    return this.repository.getArtifacts();
  }

  /**
   * Outcome Learning（§31・§44）: 成果物が役に立ったかを記録し、LESSONとしてMemoryへ還元する。
   * 例: 「新Excelで転記時間▲40%」
   */
  async recordOutcome(
    artifactId: string,
    outcome: string,
    now: string
  ): Promise<ArtifactRecord | null> {
    const all = await this.repository.getArtifacts();
    const artifact = all.find((a) => a.artifactId === artifactId);
    if (!artifact) return null;
    const updated = { ...artifact, outcomeResult: outcome };
    await this.repository.saveArtifact(updated);
    return updated;
  }
}
