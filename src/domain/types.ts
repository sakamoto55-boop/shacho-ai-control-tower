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

export interface AnalyzeMessageInput extends IncomingMessageInput {}

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
