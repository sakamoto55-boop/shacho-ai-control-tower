/**
 * Persistent Memory Layer のドメインモデル（Phase M）。
 *
 * 「学習」とはモデルのFine-tuningではなく、
 * Conversation → Memory Extraction → Validation → Persistent Memory →
 * Future Retrieval → Action / Experiment → Result → Learning
 * のPersistent Learning Loopを指す。
 *
 * 会話全文を無差別に保存せず、意味単位のAtomic Memoryとして保持する。
 * Fact / Opinion / Hypothesis を混同しない。古い記憶は履歴を失わず状態遷移させる。
 */
import type { Evidence } from '../domain/types.js';

export type MemoryType =
  | 'FACT'
  | 'DECISION'
  | 'OPINION'
  | 'HYPOTHESIS'
  | 'PREFERENCE'
  | 'PRINCIPLE'
  | 'PROBLEM'
  | 'LESSON'
  | 'EXPERIMENT'
  | 'RESULT'
  | 'COMMITMENT'
  | 'PLAYBOOK'
  | 'CONTEXT';

/** 削除ではなく状態遷移で履歴を保持する */
export type MemoryStatus =
  | 'ACTIVE'
  | 'SUPERSEDED'
  | 'CORRECTED'
  | 'EXPIRED'
  | 'REJECTED'
  | 'ARCHIVED';

export type MemoryConfidence = 'CONFIRMED' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNVERIFIED';

/** 会社の正式事実 / 経営者個人の判断・考え / 運用メモ / 外部知識 を論理分離する */
export type MemoryLayer = 'COMPANY' | 'PRESIDENT' | 'OPERATIONAL' | 'EXTERNAL';

export type MemorySource =
  | 'CONVERSATION'
  | 'GOOGLE_DRIVE'
  | 'GOOGLE_SHEETS'
  | 'GMAIL'
  | 'LINE_WORKS'
  | 'DOCUMENT'
  | 'SYSTEM'
  | 'EXTERNAL_RESEARCH';

/** 高機密は内容を複製せずReferenceのみ保持する */
export type MemorySensitivity = 'NORMAL' | 'SENSITIVE_REF';

/** Company Knowledge Graph（軽量版）のEntity種別 */
export type EntityType =
  | 'Company'
  | 'Person'
  | 'Customer'
  | 'Project'
  | 'Vendor'
  | 'Department'
  | 'System'
  | 'Policy'
  | 'Goal'
  | 'KPI'
  | 'Problem'
  | 'Decision'
  | 'Document';

export interface MemoryEntity {
  entityType: EntityType;
  /** Canonical ID（prj:xxx / cust:xxx / emp:xxx等）。未解決なら省略可 */
  entityId?: string;
  name: string;
}

export type RelationKind =
  | 'belongsTo'
  | 'affects'
  | 'causedBy'
  | 'tests'
  | 'validates'
  | 'supersedes'
  | 'conflictsWith'
  | 'relatesTo';

export interface MemoryRelation {
  kind: RelationKind;
  targetMemoryId?: string;
  targetEntity?: string;
}

/** AI抽出の重要Memoryはユーザー確認まで正式扱いしない */
export type MemoryReviewStatus = 'AUTO' | 'PENDING_REVIEW' | 'CONFIRMED_BY_USER';

export interface MemoryRecord {
  memoryId: string;
  type: MemoryType;
  /** 意味単位の1文。SENSITIVE_REFの場合は参照情報のみ（金額等の実値を含めない） */
  statement: string;
  entities: MemoryEntity[];
  relations: MemoryRelation[];
  layer: MemoryLayer;
  sensitivity: MemorySensitivity;
  companyId: string;
  projectId?: string;
  source: MemorySource;
  sourceId?: string;
  sourceTimestamp?: string;
  createdAt: string;
  updatedAt: string;
  /** Temporal Memory: この記憶が有効な期間 */
  validFrom: string;
  validUntil?: string;
  confidence: MemoryConfidence;
  status: MemoryStatus;
  /** 'user:<label>' or 'ai:curator' 等 */
  createdBy: string;
  reviewStatus: MemoryReviewStatus;
  evidence: Evidence[];
  /**
   * 同一対象を指す論理キー（例: 'person:田中:役職'）。
   * Conflict検知（同じ対象について矛盾する2つの情報）に使う。
   */
  subjectKey?: string;
  supersedes?: string;
  supersededBy?: string;
  correctionNote?: string;
}

export interface MemoryQuery {
  q?: string;
  type?: MemoryType;
  layer?: MemoryLayer;
  entityName?: string;
  companyId?: string;
  projectId?: string;
  /** この時点で有効だった記憶（Temporal Retrieval） */
  validAt?: string;
  /** 既定はACTIVEのみ。履歴込みで引くときtrue */
  includeInactive?: boolean;
  limit?: number;
}

/** Experiment Engine: 提案して終わりにせず、仮説→実験→結果→学習を保持する */
export interface ExperimentRecord {
  experimentId: string;
  companyId: string;
  hypothesisMemoryId?: string;
  hypothesis: string;
  metric: string;
  baseline: string;
  target: string;
  startedAt: string;
  plannedEndAt?: string;
  status: 'PLANNED' | 'RUNNING' | 'AWAITING_RESULT' | 'COMPLETED' | 'ABORTED';
  owner?: string;
  /** 現在値（Portfolio表示用。任意更新） */
  current?: string;
  result?: string;
  evaluation?: string;
  lessonMemoryId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
