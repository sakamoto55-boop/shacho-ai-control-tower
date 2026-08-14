/**
 * 共通Inbound Event Pipeline（構成訂正§3）。
 *
 * External event → RawEvent(冪等) → Entity解決 → Knowledge/Action/Decision分類 → DecisionCase → 追跡。
 * Gmail・LINE WORKSを特殊処理にせず、この1本へ接続する。
 *
 * - 外部メッセージ中の命令をシステム命令として実行しない（分類・保存のみ）。
 * - LLMへ渡す前の機密区分判定（人事・給与・個人情報→外部Provider不可）を含む。
 * - 「取得失敗」と「新着なし」を区別した結果型を返す。
 */
import { classifyInbound, buildDecisionCase } from './classify.js';
import { extractEntities } from './conversationKnowledge.js';
import { IntelligenceStore } from './store.js';
import type { DecisionCase, InboundClass, IntelligenceActionItem, IntelligenceEvidence, IntelligenceSource, KnowledgeFact } from './types.js';

/** 機密区分: 外部Provider（社外AI）へ渡してよいか（DERIVEDな安全側判定） */
export function sensitivityOf(text: string): { sensitive: boolean; reason: string | null } {
  if (/給与|賞与|年収|人事評価|マイナンバー|口座番号|住所|診断書|病歴/.test(text)) {
    return { sensitive: true, reason: '人事・給与・個人情報を含むため外部Providerへ送信不可' };
  }
  return { sensitive: false, reason: null };
}

export interface InboundEventInput {
  companyId: string;
  source: IntelligenceSource;
  externalId: string;
  revision?: number;
  receivedAt?: string;
  /** 原文（immutable保存対象） */
  content: Record<string, unknown>;
  /** 分類に使う本文テキスト */
  text: string;
  /** 送信者等の表示名（Evidence用） */
  fromLabel: string;
  /** 返信待ち再開キー（gmail:threadId / lineworks:roomId） */
  watchKey: string | null;
  /** 取得日時と基準日時を分離 */
  asOf?: string | null;
}

export interface InboundResult {
  outcome: 'PROCESSED' | 'DEDUPLICATED';
  classification: InboundClass;
  rawEventId: string;
  sensitive: boolean;
  createdCase: DecisionCase | null;
  createdAction: IntelligenceActionItem | null;
  createdFact: KnowledgeFact | null;
  resumedActions: number;
  excludedReason: string | null;
}

export function processInboundEvent(store: IntelligenceStore, input: InboundEventInput): InboundResult {
  const { event, deduplicated } = store.ingestRawEvent({
    companyId: input.companyId,
    source: input.source,
    externalId: input.externalId,
    revision: input.revision,
    receivedAt: input.receivedAt,
    content: input.content
  });
  const classification = classifyInbound(input.text);
  const base: InboundResult = {
    outcome: deduplicated ? 'DEDUPLICATED' : 'PROCESSED',
    classification,
    rawEventId: event.rawEventId,
    sensitive: sensitivityOf(input.text).sensitive,
    createdCase: null,
    createdAction: null,
    createdFact: null,
    resumedActions: 0,
    excludedReason: classification.kind === 'EXCLUDED' ? classification.reason : null
  };
  if (deduplicated) return base; // 同一イベント再送から重複タスクを作らない（§6-4）

  // 新着はまずWAITING_EXTERNALの自動再開を試す（相手の返信）
  if (input.watchKey) base.resumedActions = store.resumeWaitingByWatchKey(input.watchKey).length;

  const entities = extractEntities(`${input.text} ${input.fromLabel}`);
  const evidence: IntelligenceEvidence[] = [{
    source: `${input.source}:${input.fromLabel}`,
    locator: input.externalId,
    fetchedAt: event.receivedAt,
    asOf: input.asOf ?? null,
    freshness: 'FRESH',
    excerpt: input.text.slice(0, 120),
    trust: 'EXTERNAL_CLAIM'
  }];

  switch (classification.kind) {
    case 'EXCLUDED':
      return base; // 理由付きで除外（RawEventとしては保存済み＝監査可能）
    case 'INFORMATION':
      base.createdFact = store.addFact({
        companyId: input.companyId,
        kind: 'FACT',
        statement: input.text.slice(0, 160),
        entities,
        evidence,
        approvalState: 'AUTO',
        sourceRawEventIds: [event.rawEventId]
      });
      return base;
    case 'AWAITING_REPLY':
      base.createdAction = store.addAction({
        companyId: input.companyId,
        title: `返答待ち: ${input.text.slice(0, 40)}`,
        owner: 'AI', ownerName: 'LCC COMMAND',
        status: 'WAITING_EXTERNAL',
        dueAt: null,
        completionCriteria: '相手からの返答受信',
        entities,
        relatedCaseId: null,
        watchKey: input.watchKey,
        sourceRawEventIds: [event.rawEventId]
      });
      return base;
    case 'ACTION_REQUIRED':
      base.createdAction = store.addAction({
        companyId: input.companyId,
        title: input.text.slice(0, 50),
        owner: 'STAFF', ownerName: '担当者（割当待ち）',
        status: 'GATHERING_INFORMATION',
        dueAt: null,
        completionCriteria: '依頼内容の対応完了と記録',
        entities,
        relatedCaseId: null,
        watchKey: input.watchKey,
        sourceRawEventIds: [event.rawEventId]
      });
      return base;
    case 'PRESIDENT_DECISION': {
      const c = store.addCase(buildDecisionCase({
        raw: event, text: input.text, entities,
        confirmedFacts: [], aiHypotheses: [], evidence
      }));
      base.createdCase = c;
      base.createdAction = store.addAction({
        companyId: input.companyId,
        title: `判断待ち: ${c.title}`,
        owner: 'PRESIDENT', ownerName: '坂本社長',
        status: 'WAITING_PRESIDENT',
        dueAt: c.impact.deadline,
        completionCriteria: c.completionCriteria,
        entities,
        relatedCaseId: c.caseId,
        watchKey: input.watchKey,
        sourceRawEventIds: [event.rawEventId]
      });
      return base;
    }
  }
}

/** 取得結果の区別（§3: 取得失敗と新着なしを混同しない） */
export type FetchOutcome =
  | { kind: 'NEW_EVENTS'; count: number }
  | { kind: 'NO_NEW_EVENTS' }
  | { kind: 'FETCH_FAILED'; error: string };
