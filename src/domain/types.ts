export type MessageSource = 'gmail' | 'lineworks' | 'manual_import' | 'external_forward';

export type OriginalChannel = 'private_line' | 'sms' | 'phone_call' | 'paper_memo' | 'other' | '';

export type Priority = 'A' | 'B' | 'C';

export type RiskType =
  | 'complaint'
  | 'lost_order'
  | 'gross_profit'
  | 'payment_delay'
  | 'site_stop'
  | 'manpower_shortage'
  | 'accident'
  | 'contract'
  | 'labor'
  | 'none';

export type RiskLevel = 'high' | 'medium' | 'low' | 'none';
export type Confidence = 'high' | 'medium' | 'low';

export type InboxStatus = 'unreviewed' | 'reviewed' | 'task_created' | 'draft_created' | 'archived';

export type OwnerType =
  | 'president'
  | 'sales'
  | 'construction'
  | 'backoffice'
  | 'partner'
  | 'unknown';

export type TaskStatus = 'todo' | 'doing' | 'done' | 'pending' | 'canceled';

export type ReplyTone =
  | 'external_polite'
  | 'internal_instruction'
  | 'partner_request'
  | 'apology_careful'
  | 'confirmation_only';

export type ApprovalStatus = 'waiting' | 'approved' | 'needs_revision' | 'sent' | 'canceled';

/**
 * 会話ログの1メッセージ。送信者が社長か相手かを明示する。
 * senderType='president' の発言は背景情報として扱い、タスク・返信対象にしない。
 */
export interface ChatMessage {
  /** 'president' = 社長（自分）が送った言葉 / 'other' = 相手から受け取った言葉 */
  senderType: 'president' | 'other';
  senderName: string;
  text: string;
  timestamp: string;
}

export interface IncomingMessageInput {
  source: MessageSource;
  externalMessageId?: string;
  originalChannel?: OriginalChannel;
  receivedAt: string;
  senderName: string;
  senderAddress: string;
  roomName: string;
  subject: string;
  text: string;
}

export interface AnalyzeMessageInput extends IncomingMessageInput {
  /**
   * 会話の流れを保持する配列。
   * 提供された場合、AIは最後の発言者が社長かどうかを判断して返信要否を決定する。
   */
  chatHistory?: ChatMessage[];
}

export interface AnalyzeTaskResult {
  taskTitle: string;
  taskDetail: string;
  ownerType: OwnerType;
  ownerName: string;
  dueDate: string | null;
  dueDateText: string;
  priority: Priority;
  requiresPresident: boolean;
  nextAction: string;
  reason: string;
}

export interface AnalyzeReplyDraftResult {
  needed: boolean;
  text: string;
  tone: ReplyTone;
  confirmationNeeded: string[];
  ngReasons: string[];
}

export interface AnalyzeRiskResult {
  type: RiskType;
  level: RiskLevel;
  reason: string;
}

export interface AnalyzeMessageResult {
  summary: string;
  projectName: string;
  customerName: string;
  priority: Priority;
  replyNeeded: boolean;
  tasks: AnalyzeTaskResult[];
  replyDraft: AnalyzeReplyDraftResult;
  risk: AnalyzeRiskResult;
  confidence: Confidence;
}

export interface InboxRecord {
  id: string;
  source: MessageSource;
  externalMessageId: string;
  originalChannel?: OriginalChannel;
  receivedAt: string;
  senderName: string;
  senderAddress: string;
  roomName: string;
  subject: string;
  originalText: string;
  normalizedText: string;
  summary: string;
  projectName: string;
  customerName: string;
  priority: Priority;
  replyNeeded: boolean;
  riskType: RiskType;
  riskLevel: RiskLevel;
  confidence: Confidence;
  status: InboxStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TaskRecord {
  id: string;
  sourceInboxId: string;
  taskTitle: string;
  taskDetail: string;
  ownerType: OwnerType;
  ownerName: string;
  dueDate: string | null;
  dueDateText: string;
  priority: Priority;
  projectName: string;
  customerName: string;
  nextAction: string;
  requiresPresident: boolean;
  status: TaskStatus;
  reason: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReplyDraftRecord {
  id: string;
  sourceInboxId: string;
  recipientName: string;
  recipientAddress: string;
  draftText: string;
  tone: ReplyTone;
  confirmationNeeded: string[];
  ngReasons: string[];
  approvalStatus: ApprovalStatus;
  createdAt: string;
  updatedAt: string;
}

export interface StoredMessageBundle {
  inbox: InboxRecord;
  tasks: TaskRecord[];
  replyDraft?: ReplyDraftRecord;
}

export interface ReportCounts {
  importantUnreplied: number;
  presidentDecision: number;
  delegateTasks: number;
  dueToday: number;
  risks: number;
  replyDrafts: number;
  overdue: number;
}

export interface DailyReport {
  kind: 'morning' | 'noon' | 'evening';
  generatedAt: string;
  text: string;
  counts: ReportCounts;
}

/**
 * 会社運営チームを構成する役割別AIエージェント。
 * 'risk_officer'と'president_office'は担当者(OwnerType)ではなく、
 * 全メッセージに目を通す横断的な役割として常に評価する。
 */
export type TeamRole = 'sales' | 'construction' | 'backoffice' | 'partner' | 'risk_officer' | 'president_office';

export interface TeamRoleReview {
  role: TeamRole;
  relevant: boolean;
  recommendation: string;
  requiresPresident: boolean;
  confidence: Confidence;
}

export interface CompanyOperationsTeamReview {
  leadRole: OwnerType;
  reviews: TeamRoleReview[];
  teamSummary: string;
}
