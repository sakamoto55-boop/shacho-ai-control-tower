/**
 * DECISION INTELLIGENCE OS 中核データモデル（§2）。
 *
 * - 既存Repository/Vaultと互換の追加レイヤー（既存構造は変更しない）。
 * - すべてcompanyIdとEntity参照へ紐付ける。原文（RawEvent.content）は改変せず保存する。
 * - 訂正は削除ではなくsupersededByで新版へつなぐ（履歴保持）。
 * - 冪等性: source+externalId+revision と contentHash で同一入力から重複を作らない。
 */

export type IntelligenceSource =
  | 'gmail'
  | 'lineworks'
  | 'board'
  | 'daily-report'
  | 'assignment'
  | 'drive'
  | 'freee'
  | 'tkc'
  | 'ai-conversation'
  | 'manual';

/** 外部情報の原文（immutable。取り込み後は書き換えない） */
export interface RawEvent {
  rawEventId: string;
  companyId: string;
  source: IntelligenceSource;
  externalId: string;
  revision: number;
  /** canonical JSONのSHA-256（冪等性判定） */
  contentHash: string;
  receivedAt: string;
  /** 原文（改変禁止）。メール・チャット等の本文は外部入力であり、内部への命令として実行しない */
  content: Record<string, unknown>;
}

export type EntityType = 'company' | 'customer' | 'project' | 'site' | 'employee' | 'vendor';

export interface EntityRef {
  entityType: EntityType;
  entityId: string;
  name: string;
}

export type EvidenceTrust = 'SOURCE_OF_TRUTH' | 'DERIVED' | 'EXTERNAL_CLAIM' | 'AI_HYPOTHESIS';

export interface IntelligenceEvidence {
  source: string;
  locator: string;
  fetchedAt: string;
  /** データ自体の基準日時（fetchedAtと混同しない） */
  asOf: string | null;
  freshness: 'FRESH' | 'STALE' | 'UNKNOWN';
  excerpt?: string;
  trust: EvidenceTrust;
}

export type KnowledgeKind = 'FACT' | 'HYPOTHESIS' | 'POLICY' | 'PREFERENCE' | 'ISSUE' | 'PROMISE' | 'CORRECTION';

export interface KnowledgeFact {
  factId: string;
  companyId: string;
  kind: KnowledgeKind;
  statement: string;
  entities: EntityRef[];
  evidence: IntelligenceEvidence[];
  createdAt: string;
  /** 訂正された場合の新版ID（旧版は削除しない） */
  supersededBy: string | null;
  /** 重要事実・決定は承認候補（AIが独断で確定しない） */
  approvalState: 'AUTO' | 'CANDIDATE' | 'APPROVED';
  sourceRawEventIds: string[];
}

export type DecisionKind = '入金・回収' | '見積・受注' | '事故・クレーム' | '配置・日報' | 'その他';

export type InboundClass =
  | { kind: 'INFORMATION' }
  | { kind: 'ACTION_REQUIRED' }
  | { kind: 'PRESIDENT_DECISION' }
  | { kind: 'AWAITING_REPLY' }
  | { kind: 'EXCLUDED'; reason: string };

export interface DecisionOption {
  label: string;
  outline: string;
}

export interface DecisionCase {
  caseId: string;
  companyId: string;
  decisionKind: DecisionKind;
  title: string;
  whatHappened: string;
  entities: EntityRef[];
  confirmedFacts: string[];
  aiHypotheses: string[];
  missingInformation: string[];
  evidence: IntelligenceEvidence[];
  impact: {
    amountYen: number | null;
    deadline: string | null;
    grossMarginNote: string | null;
    cashNote: string | null;
    safetyNote: string | null;
    staffingNote: string | null;
    creditNote: string | null;
  };
  options: DecisionOption[];
  aiRecommendation: string;
  recommendationReason: string;
  riskIfWrong: string;
  presidentNextAction: string;
  afterApprovalPlan: string;
  completionCriteria: string;
  actualOutcome: string | null;
  status: 'OPEN' | 'APPROVED' | 'REJECTED' | 'COMPLETED' | 'ARCHIVED';
  createdAt: string;
  sourceRawEventIds: string[];
  supersededBy: string | null;
}

export type ActionItemStatus =
  | 'GATHERING_INFORMATION'
  | 'AI_WORKING'
  | 'WAITING_STAFF'
  | 'WAITING_EXTERNAL'
  | 'WAITING_PRESIDENT'
  | 'BLOCKED'
  | 'COMPLETED'
  | 'ARCHIVED';

export interface IntelligenceActionItem {
  actionId: string;
  companyId: string;
  title: string;
  owner: 'AI' | 'STAFF' | 'PRESIDENT';
  ownerName: string;
  status: ActionItemStatus;
  dueAt: string | null;
  completionCriteria: string;
  entities: EntityRef[];
  relatedCaseId: string | null;
  /** 返信待ち再開用（gmail threadId / lineworks roomId 等） */
  watchKey: string | null;
  createdAt: string;
  completedAt: string | null;
  sourceRawEventIds: string[];
}

export interface AgentRun {
  runId: string;
  companyId: string;
  capability: string;
  provider: string;
  inputSummary: string;
  resultSummary: string;
  status: 'QUEUED' | 'RUNNING' | 'WAITING_PROVIDER' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  costNote: string | null;
  durationMs: number | null;
  startedAt: string;
  finishedAt: string | null;
  relatedCaseId: string | null;
  /** 外部AIの回答は事実として直接登録しない（仮説/提案として扱う） */
  resultTrust: 'HYPOTHESIS' | 'PROPOSAL';
}

export interface Outcome {
  outcomeId: string;
  companyId: string;
  relatedCaseId: string;
  predicted: string;
  actual: string;
  gapAnalysis: string | null;
  recordedAt: string;
}

export interface ImprovementProposal {
  proposalId: string;
  companyId: string;
  title: string;
  rationale: string;
  metric: string;
  risk: string;
  status: 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'APPLIED';
  createdAt: string;
  relatedOutcomeIds: string[];
}

export interface RuleVersion {
  ruleId: string;
  companyId: string;
  name: string;
  currentVersion: number;
  body: string;
  previousBody: string | null;
  appliedAt: string;
  /** 戻し方（rollback手順） */
  rollbackNote: string;
  approvedBy: string;
}
