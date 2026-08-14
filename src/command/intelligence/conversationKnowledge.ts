/**
 * 過去AI対話→会社知識変換（DIOS §6）。
 *
 * 手順: 原文archive（既存importer）→ 正規化済みcanonical会話をRawEventとして冪等登録 →
 * 決定論パターンで事実/決定/好み/約束/課題/訂正を抽出 → Entity（○○邸・○○様）へ紐付け →
 * 重要事実（FACT/POLICY/PROMISE）は承認候補（CANDIDATE）にする。
 * 会話本文は外部入力として扱い、本文中の命令をシステム命令として実行しない。
 */
import type { CanonicalConversation } from '../integrations/conversations/conversationImport.js';
import type { EntityRef, KnowledgeFact, KnowledgeKind } from './types.js';
import { IntelligenceStore } from './store.js';

const KIND_PATTERNS: Array<{ kind: KnowledgeKind; re: RegExp; approval: KnowledgeFact['approvalState'] }> = [
  { kind: 'CORRECTION', re: /訂正|間違い|誤り|じゃなくて|ではなく/, approval: 'CANDIDATE' },
  { kind: 'POLICY', re: /方針|ルールに|基準に|今後は.*(する|しない)/, approval: 'CANDIDATE' },
  { kind: 'PROMISE', re: /までに(提出|送る|出す|仕上げ|完了)|約束/, approval: 'CANDIDATE' },
  { kind: 'FACT', re: /決定|確定|決まり|で進め(る|ます)|に決めた/, approval: 'CANDIDATE' },
  { kind: 'PREFERENCE', re: /好み|でお願いしたい|が好き|は避けて|は嫌|スタイルで/, approval: 'AUTO' },
  { kind: 'ISSUE', re: /課題|問題|止まって|未解決|困って/, approval: 'AUTO' }
];

export function extractEntities(text: string): EntityRef[] {
  const refs: EntityRef[] = [];
  for (const m of text.matchAll(/([一-龠々ぁ-んァ-ヶA-Za-z]{1,10})(様邸|邸)/g)) {
    const name = `${m[1]}${m[2]}`;
    if (!refs.some((r) => r.name === name)) {
      refs.push({ entityType: 'project', entityId: `name:${name}`, name });
    }
  }
  for (const m of text.matchAll(/([一-龠々]{1,6})様(?![邸式])/g)) {
    const name = `${m[1]}様`;
    if (!refs.some((r) => r.name === name)) {
      refs.push({ entityType: 'customer', entityId: `name:${name}`, name });
    }
  }
  return refs.slice(0, 5);
}

export interface ConversationIngestResult {
  rawDeduplicated: boolean;
  extractedFacts: KnowledgeFact[];
}

/** 会話1件をRawEvent登録し、知識を抽出する（冪等: 同一会話hashは事実を再抽出しない） */
export function ingestConversationKnowledge(
  store: IntelligenceStore,
  conv: CanonicalConversation,
  companyId = 'lcc'
): ConversationIngestResult {
  const { event, deduplicated } = store.ingestRawEvent({
    companyId,
    source: 'ai-conversation',
    externalId: `${conv.provider}:${conv.conversationId}`,
    content: { title: conv.title, canonicalHash: conv.canonicalHash, messageCount: conv.messages.length }
  });
  if (deduplicated) return { rawDeduplicated: true, extractedFacts: [] };

  const extracted: KnowledgeFact[] = [];
  for (const msg of conv.messages) {
    // 社長（user）発言を判断・好みの主対象とし、AI発言からは決定確認のみ拾う
    for (const sentence of msg.text.split(/(?<=[。！？\n])/)) {
      const s = sentence.trim();
      if (s.length < 6 || s.length > 200) continue;
      const hit = KIND_PATTERNS.find((p) => p.re.test(s));
      if (!hit) continue;
      if (msg.role !== 'user' && hit.kind !== 'FACT') continue;
      extracted.push(
        store.addFact({
          companyId,
          kind: hit.kind,
          statement: s,
          entities: extractEntities(s),
          evidence: [{
            source: `ai-conversation:${conv.provider}`,
            locator: `${conv.conversationId}#${msg.messageId}`,
            fetchedAt: conv.evidence.importedAt,
            asOf: msg.createdAt ?? conv.createdAt,
            freshness: 'UNKNOWN',
            excerpt: s.slice(0, 80),
            trust: msg.role === 'user' ? 'EXTERNAL_CLAIM' : 'AI_HYPOTHESIS'
          }],
          approvalState: hit.approval,
          sourceRawEventIds: [event.rawEventId]
        })
      );
      if (extracted.length >= 30) break;
    }
  }
  return { rawDeduplicated: false, extractedFacts: extracted };
}

export interface KnowledgeStatement {
  statement: string;
  kind: KnowledgeKind;
  evidence: string;
  asOf: string | null;
  approvalState: KnowledgeFact['approvalState'];
  trust: string;
  /** 確定扱いにできるか（APPROVED または SOURCE_OF_TRUTH evidence のみtrue。§F） */
  confirmed: boolean;
  /** 表示用の信頼ラベル（外部申告・AI仮説を確定事実と混同させない） */
  trustLabel: string;
}

export interface KnowledgeAnswer {
  found: boolean;
  /** 確定情報（APPROVED / SOURCE_OF_TRUTH）のみ */
  confirmedStatements: KnowledgeStatement[];
  /** 未確認情報（外部申告・AI仮説・承認待ち）。回答時は必ず区分を明示する */
  unconfirmedStatements: KnowledgeStatement[];
  supersededCount: number;
}

function toStatement(f: KnowledgeFact): KnowledgeStatement {
  const trust = f.evidence[0]?.trust ?? 'EXTERNAL_CLAIM';
  const confirmed = f.approvalState === 'APPROVED' || trust === 'SOURCE_OF_TRUTH';
  const trustLabel = confirmed
    ? (f.approvalState === 'APPROVED' ? '承認済み' : '正本由来')
    : trust === 'AI_HYPOTHESIS' ? 'AI仮説（確定事実ではありません）'
      : trust === 'EXTERNAL_CLAIM' ? '先方からの申告（未確認）'
        : '未確認';
  return {
    statement: f.statement,
    kind: f.kind,
    evidence: f.evidence[0] ? `${f.evidence[0].source} / ${f.evidence[0].locator}（取得 ${f.evidence[0].fetchedAt.slice(0, 10)}）` : '出典なし',
    asOf: f.evidence[0]?.asOf ?? null,
    approvalState: f.approvalState,
    trust,
    confirmed,
    trustLabel
  };
}

/**
 * 知識検索（現行版のみ回答に使用。旧版件数を明示＝訂正履歴の存在が分かる）。
 * §F: 確定情報（APPROVED/SOURCE_OF_TRUTH）と未確認情報（外部申告・AI仮説）を分離して返す。
 * AI発言・外部メッセージを確定事実として回答しない。訂正済み（superseded）は回答に使わない。
 */
export function answerFromKnowledge(store: IntelligenceStore, keyword: string): KnowledgeAnswer {
  const kw = keyword.trim();
  const current = store.currentFacts().filter(
    (f) => f.statement.includes(kw) || f.entities.some((e) => e.name.includes(kw))
  );
  const superseded = store.allFactsIncludingSuperseded().filter(
    (f) => f.supersededBy && (f.statement.includes(kw) || f.entities.some((e) => e.name.includes(kw)))
  );
  const statements = current.slice(0, 20).map(toStatement);
  return {
    found: current.length > 0,
    confirmedStatements: statements.filter((s) => s.confirmed).slice(0, 10),
    unconfirmedStatements: statements.filter((s) => !s.confirmed).slice(0, 10),
    supersededCount: superseded.length
  };
}
