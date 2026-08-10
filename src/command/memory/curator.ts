/**
 * Memory Curator — 会話からMemory候補を抽出する。
 *
 * 自動確定ルール:
 * - 低リスクのCONTEXT/PREFERENCE/OPINION/HYPOTHESIS/PROBLEM/COMMITMENTは自動保存（AUTO）
 * - DECISION・FACT変更はPENDING_REVIEW（AIが独断で会社の正式方針を書き換えない）
 * - 意見・印象（「〜じゃない？」「〜と思う」）は絶対にFACTとして保存しない
 *   → HYPOTHESIS/OPINION + UNVERIFIED として保存し、データで検証可能にする
 */
import type { CommandDataset } from '../data/seed.js';
import type { Principal } from '../domain/types.js';
import type { MemoryConfidence, MemoryEntity, MemoryLayer, MemoryType } from './types.js';
import type { MemoryService, NewMemoryInput, SaveResult } from './store.js';

/**
 * LLM Curator v2（Phase B1 §7）: LLMによる候補抽出のフック。
 * LLMは「候補を提案する」だけで、保存可否は既存のLearning Safety
 * （MemoryService.validate）とここでの決定論ルールが最終判定する。
 */
export interface LlmMemoryCandidate {
  type: MemoryType;
  statement: string;
  confidence?: MemoryConfidence;
  layer?: MemoryLayer;
}

export type LlmCandidateExtractor = (message: string) => Promise<LlmMemoryCandidate[]>;

export interface CuratorOutcome {
  saved: SaveResult[];
  /** ユーザーへ返す補足（矛盾検出・確認依頼など） */
  notices: string[];
  /** 是正⑦: LLM抽出の失敗を無言にしない（diagnostics記録用。会話は止めない） */
  llmFailure?: { reasonCode: string; retryable: boolean; occurredAt: string };
}

/** 発話から既知Entity（案件・顧客・社員）を拾う */
export function extractEntities(dataset: CommandDataset, text: string): MemoryEntity[] {
  const entities: MemoryEntity[] = [];
  for (const project of dataset.projects) {
    const shortName = project.name.split('（')[0];
    if (shortName.length >= 3 && text.includes(shortName.slice(0, 3))) {
      entities.push({ entityType: 'Project', entityId: project.projectId, name: project.name });
    }
  }
  for (const customer of dataset.customers) {
    const base = customer.name.replace(/株式会社/g, '');
    if (base.length >= 2 && text.includes(base.slice(0, 2))) {
      entities.push({ entityType: 'Customer', entityId: customer.customerId, name: customer.name });
    }
  }
  for (const employee of dataset.employees) {
    if (text.includes(employee.name)) {
      entities.push({ entityType: 'Person', entityId: employee.employeeId, name: employee.name });
    }
  }
  if (/営業部|営業チーム/.test(text)) entities.push({ entityType: 'Department', name: '営業部' });
  if (/工事部|現場チーム/.test(text)) entities.push({ entityType: 'Department', name: '工事部' });
  return entities.slice(0, 5);
}

interface Extraction {
  input: Omit<
    NewMemoryInput,
    | 'companyId'
    | 'entities'
    | 'source'
    | 'createdBy'
    | 'validFrom'
    | 'evidence'
    | 'relations'
    | 'layer'
    | 'sensitivity'
    | 'reviewStatus'
  > &
    Partial<Pick<NewMemoryInput, 'layer' | 'reviewStatus' | 'confidence'>>;
}

/** ルールベースの抽出。会話全文ではなく意味単位のAtomic Memoryを作る */
function extractCandidates(message: string): Extraction[] {
  const results: Extraction[] = [];
  const text = message.trim();

  // 意見・印象 → HYPOTHESIS（FACT化の絶対禁止）
  if (
    /(弱くない|悪くない|まずくない|じゃない？|のでは？|気がする|と思う)/.test(text) &&
    text.length <= 120
  ) {
    results.push({
      input: {
        type: /と思う|気がする/.test(text) ? 'OPINION' : 'HYPOTHESIS',
        statement: `「${text}」という${/と思う|気がする/.test(text) ? '意見' : '可能性の指摘'}（未検証。データでの検証が必要）`,
        confidence: 'UNVERIFIED'
      }
    });
  }

  // 方針・決定の宣言 → DECISION候補（PENDING_REVIEW。AIは確定しない）
  const decisionMatch = text.match(
    /(.{4,60}?)(することにした|する方針にする|でいく|で行く|に決めた|をやめる|は中止)/
  );
  if (decisionMatch) {
    results.push({
      input: {
        type: 'DECISION',
        statement: `${decisionMatch[1]}${decisionMatch[2]}`,
        confidence: 'HIGH',
        reviewStatus: 'PENDING_REVIEW',
        layer: 'PRESIDENT'
      }
    });
  }

  // 問題の申告 → PROBLEM
  const problemMatch = text.match(/(.{3,60}?)(が問題|で困って|が課題|がうまくいっていない)/);
  if (problemMatch) {
    results.push({
      input: {
        type: 'PROBLEM',
        statement: `${problemMatch[1]}${problemMatch[2]}いる`,
        confidence: 'MEDIUM'
      }
    });
  }

  // 好み・スタイル → PREFERENCE
  if (/(簡潔に|短くまとめて|結論から|数字で示して|ですます調で)/.test(text)) {
    results.push({
      input: {
        type: 'PREFERENCE',
        statement: `回答スタイルの好み: ${text.slice(0, 60)}`,
        confidence: 'HIGH',
        layer: 'PRESIDENT'
      }
    });
  }

  // 約束・期限 → COMMITMENT
  const commitMatch = text.match(
    /(今日中|明日|今週中|来週|月末まで)に(.{2,40}?)(する|やる|送る|決める)/
  );
  if (commitMatch) {
    results.push({
      input: {
        type: 'COMMITMENT',
        statement: `${commitMatch[1]}に${commitMatch[2]}${commitMatch[3]}`,
        confidence: 'HIGH'
      }
    });
  }

  return results;
}

/** ユーザー訂正の検知（重要イベント） */
export function detectCorrection(message: string): {
  isCorrection: boolean;
  newContent: string | null;
} {
  if (
    !/(それ違う|それは違う|間違って|今のは違う|今は|情報.{0,3}古い|それやめた|方針変えた|もう違う)/.test(
      message
    )
  ) {
    return { isCorrection: false, newContent: null };
  }
  const contentMatch = message.match(/今は(.{2,80})/);
  return {
    isCorrection: true,
    newContent: contentMatch ? contentMatch[1].replace(/[。．]$/, '') : null
  };
}

export async function curateConversationTurn(
  service: MemoryService,
  dataset: CommandDataset,
  message: string,
  principal: Principal,
  companyId: string,
  now: string,
  sessionId: string,
  llmExtractor?: LlmCandidateExtractor
): Promise<CuratorOutcome> {
  const outcome: CuratorOutcome = { saved: [], notices: [] };
  const entities = extractEntities(dataset, message);
  const projectEntity = entities.find((e) => e.entityType === 'Project');

  const candidates = extractCandidates(message);

  // LLM抽出候補（任意）。決定論ルールで格下げしてから既存の保存経路へ流す。
  if (llmExtractor) {
    try {
      for (const raw of (await llmExtractor(message)).slice(0, 5)) {
        if (!raw.statement || raw.statement.length > 300) continue;
        const needsReview =
          raw.type === 'DECISION' || raw.type === 'PLAYBOOK' || raw.type === 'PRINCIPLE';
        candidates.push({
          input: {
            // LLMの推測でFACT確定させない: FACTはHYPOTHESIS + UNVERIFIED に格下げ
            type: raw.type === 'FACT' ? 'HYPOTHESIS' : raw.type,
            statement:
              raw.type === 'FACT'
                ? `${raw.statement}（LLM抽出。FACT確定は根拠確認後）`
                : raw.statement,
            confidence: raw.type === 'FACT' ? 'UNVERIFIED' : (raw.confidence ?? 'UNVERIFIED'),
            layer: raw.layer,
            reviewStatus: needsReview ? 'PENDING_REVIEW' : 'AUTO'
          }
        });
      }
    } catch (error) {
      // LLM抽出の失敗はルールベース抽出のみで続行（是正⑦: ただし失敗を無言にせず返す）
      const status =
        typeof error === 'object' && error !== null && 'status' in error
          ? Number((error as { status?: unknown }).status)
          : undefined;
      const reasonCode =
        status === 401 || status === 403
          ? 'AI_AUTH_FAILED'
          : status === 429
            ? 'AI_RATE_LIMITED'
            : 'AI_TEMPORARILY_UNAVAILABLE';
      outcome.llmFailure = {
        reasonCode,
        retryable: reasonCode !== 'AI_AUTH_FAILED',
        occurredAt: new Date().toISOString()
      };
    }
  }

  for (const candidate of candidates) {
    try {
      const saved = await service.save(
        {
          type: candidate.input.type,
          statement: candidate.input.statement,
          entities,
          relations: projectEntity
            ? [{ kind: 'relatesTo', targetEntity: projectEntity.entityId }]
            : [],
          layer: candidate.input.layer ?? 'OPERATIONAL',
          sensitivity: 'NORMAL',
          companyId,
          projectId: projectEntity?.entityId,
          source: 'CONVERSATION',
          sourceId: sessionId,
          sourceTimestamp: now,
          validFrom: now.slice(0, 10),
          confidence: candidate.input.confidence ?? 'UNVERIFIED',
          createdBy: `ai:curator(${principal.label})`,
          reviewStatus: candidate.input.reviewStatus ?? 'AUTO',
          evidence: [
            {
              label: '発言',
              value: message.slice(0, 120),
              source: `会話（${principal.label}）`,
              asOf: now
            }
          ]
        },
        now
      );
      outcome.saved.push(saved);
      if (saved.conflictsWith.length > 0) {
        outcome.notices.push(
          `※既存の記憶と矛盾する可能性があります（${saved.conflictsWith.map((m) => m.statement).join(' / ')}）。どちらが正しいか確認してください。`
        );
      }
      if (saved.record.reviewStatus === 'PENDING_REVIEW' && !saved.mergedIntoExisting) {
        outcome.notices.push(
          `※「${saved.record.statement}」を判断候補として記録しました（確認待ち。正式方針はAIが独断で確定しません）。`
        );
      }
    } catch {
      // Learning Safety違反（機微情報等）は保存せずスキップ（会話は継続）
    }
  }
  return outcome;
}
