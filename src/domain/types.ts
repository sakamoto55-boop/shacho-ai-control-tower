export type MessageSource = 'gmail' | 'lineworks' | 'manual_import' | 'external_forward';

export type OriginalChannel =
  | 'private_line'
  | 'sms'
  | 'phone_call'
  | 'paper_memo'
  | 'sns'
  | 'other'
  | '';

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

/* ------------------------------------------------------------------ *
 * SNS集客・収益化（リードから受注までのパイプライン）
 * ------------------------------------------------------------------ */

/** 反響が発生したSNS・Web上の窓口 */
export type SnsChannel =
  | 'instagram'
  | 'x'
  | 'youtube'
  | 'tiktok'
  | 'facebook'
  | 'google_business'
  | 'web_form';

/** 5事業のどれに紐づく反響・投稿か */
export type BusinessLine =
  | 'construction'
  | 'demolition'
  | 'exterior'
  | 'realestate'
  | 'welfare'
  | 'unknown';

/** 見込み客の進行段階。won/lostが終了状態。 */
export type LeadStage =
  | 'new'
  | 'contacted'
  | 'estimating'
  | 'proposed'
  | 'won'
  | 'lost'
  | 'nurturing';

/** 受注確度の温度感。hotは当日中に一次返信すべき反響。 */
export type LeadTemperature = 'hot' | 'warm' | 'cold';

/** 投稿の目的。集客導線か、信頼構築か、採用かで文面と締めが変わる。 */
export type SnsPostPurpose =
  | 'lead_generation'
  | 'trust_building'
  | 'case_study'
  | 'recruiting'
  | 'seasonal';

/** SNSのDM・コメント・問い合わせフォームから届いた1件の反響 */
export interface SnsInquiryInput {
  channel: SnsChannel;
  externalInquiryId?: string;
  receivedAt: string;
  /** 相手のアカウントID（@handleなど） */
  accountName: string;
  /** 相手の表示名。空でもよい。 */
  displayName: string;
  text: string;
  /** どの投稿への反応か（投稿URLやID） */
  postRef?: string;
  /** 相手が書いていれば地域 */
  area?: string;
  /** 相手が書いていれば連絡先（電話・メール） */
  contact?: string;
}

export interface SnsInquiryAnalysisResult {
  summary: string;
  businessLine: BusinessLine;
  temperature: LeadTemperature;
  /** 0〜100。受注確度の目安。 */
  leadScore: number;
  /** 見込み金額（円）。判断材料が無ければnull。 */
  estimatedValueYen: number | null;
  isSpam: boolean;
  spamReason: string;
  /** 受注につながる発言（「見積が欲しい」「今月中に」など） */
  buyingSignals: string[];
  /** 返信前に聞くべき不足情報 */
  missingInfo: string[];
  priority: Priority;
  replyDraft: AnalyzeReplyDraftResult;
  nextAction: string;
  /** 次回追客日（YYYY-MM-DD）。不要ならnull。 */
  followUpDate: string | null;
  confidence: Confidence;
}

export interface LeadRecord {
  id: string;
  /** 紐づくAI受信箱レコード。既存の朝昼晩レポートからも見えるようにする。 */
  sourceInboxId: string;
  channel: SnsChannel;
  externalInquiryId: string;
  receivedAt: string;
  accountName: string;
  displayName: string;
  contact: string;
  area: string;
  postRef: string;
  inquiryText: string;
  summary: string;
  businessLine: BusinessLine;
  temperature: LeadTemperature;
  leadScore: number;
  estimatedValueYen: number | null;
  stage: LeadStage;
  isSpam: boolean;
  buyingSignals: string[];
  missingInfo: string[];
  nextAction: string;
  followUpDate: string | null;
  /** 追客タスクを自動生成した回数。上限に達したらnurturingへ落とす。 */
  followUpCount: number;
  lastContactedAt: string | null;
  ownerType: OwnerType;
  createdAt: string;
  updatedAt: string;
}

/** 投稿1件を生成するための指示。投稿カレンダーの1コマに相当する。 */
export interface SnsPostGenerationInput {
  channel: SnsChannel;
  /** YYYY-MM-DD */
  scheduledDate: string;
  /** HH:mm */
  scheduledTime: string;
  businessLine: BusinessLine;
  purpose: SnsPostPurpose;
  theme: string;
  area?: string;
  /** 実績値や現場情報など、本文に織り込む素材 */
  highlights?: string[];
}

export interface SnsPostDraftResult {
  title: string;
  body: string;
  hashtags: string[];
  callToAction: string;
  /** 撮影・用意してほしい写真や素材の指示 */
  mediaHint: string;
  /** 景表法・誇大広告など、そのまま出せない理由 */
  ngReasons: string[];
}

export interface SnsPostDraftRecord {
  id: string;
  channel: SnsChannel;
  scheduledDate: string;
  scheduledTime: string;
  businessLine: BusinessLine;
  purpose: SnsPostPurpose;
  theme: string;
  title: string;
  body: string;
  hashtags: string[];
  callToAction: string;
  mediaHint: string;
  ngReasons: string[];
  approvalStatus: ApprovalStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredLeadBundle {
  inbox: InboxRecord;
  lead: LeadRecord;
  tasks: TaskRecord[];
  replyDraft?: ReplyDraftRecord;
}

export interface RevenueCounts {
  postDraftsWaiting: number;
  postsScheduled: number;
  newLeads: number;
  hotLeads: number;
  unrepliedLeads: number;
  followUpDue: number;
  estimatingLeads: number;
  wonLeads: number;
  lostLeads: number;
  /** 進行中リードの見込み金額合計（円） */
  pipelineValueYen: number;
  /** 段階別の確度で重み付けした見込み金額（円） */
  weightedPipelineValueYen: number;
  /** 受注済みリードの金額合計（円） */
  wonValueYen: number;
}

export interface RevenueReport {
  kind: 'revenue';
  generatedAt: string;
  text: string;
  counts: RevenueCounts;
}
