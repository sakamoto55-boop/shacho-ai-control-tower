/**
 * Knowledge Search V1（TRACK B: 実用到達テスト2-5）。
 *
 * Raw Vault（JSONL）を横断検索し、案件名・現場名・キーワードから
 * 日報・LINE WORKSメッセージ・法定書類・顧客/案件行を引き当てる。
 *
 * 固定原則:
 * - READ ONLY（Vaultの読み取りのみ。Source APIは呼ばない）
 * - 名称一致は候補（LOW）であり確定紐付けではない（自動統合しない）
 * - 結果は必ずEvidence（spreadsheet ID + タブ!行）と syncedAt を持つ
 * - 未接続SourceはNOT_CONNECTEDとして正直に返す（0件と断定しない）
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IntegrationRecord } from '../common/types.js';
import { defaultVaultDir } from '../sheets/sheetsVaultSync.js';

export interface KnowledgeHit {
  sourceSystem: string;
  sourceRecordId: string;
  sourceSheet: string | null;
  sourceRow: number | null;
  /** 一致したフィールドの抜粋（フィールド名: 値の先頭80字） */
  snippet: string[];
  matchedTokens: string[];
  /** 名称一致は確定ではない（Crosswalk LOW相当） */
  linkConfidence: 'LOW';
  evidence: IntegrationRecord['evidence'];
  syncedAt: string;
}

export interface KnowledgeSearchResult {
  query: string;
  tokens: string[];
  hits: KnowledgeHit[];
  /** Source別の走査状況（未接続を0件と偽らない） */
  sources: { key: string; status: 'SEARCHED' | 'NOT_CONNECTED'; scanned: number; hits: number }[];
  note: string;
}

const VAULT_SOURCE_KEYS = [
  'lcc-integrated-db',
  'daily-report-ai',
  'lineworks-inbox',
  'lcc-case-db'
] as const;

/** 日本語の内容語トークン化（memory storeと同方針: 助詞・動詞語尾で分割） */
export function tokenizeQuery(q: string): string[] {
  const coarse = q.split(/[\s、。,・]+/);
  const fine = coarse.flatMap((seg) =>
    seg.split(
      /(?:している|してる|します|した|する|です|ます|を|の|に|へ|が|は|で|と|も|や|から|まで|様邸|様|殿)+/
    )
  );
  return [...new Set([...coarse, ...fine].map((t) => t.trim()).filter((t) => t.length >= 2))];
}

interface LoadedSource {
  key: string;
  records: IntegrationRecord[];
}

/** Vault JSONLの読み込み（1ファイル最大maxRecords行。テストでvaultDir注入可） */
export function loadVaultSources(
  vaultDir = defaultVaultDir(),
  maxRecords = 20000
): { loaded: LoadedSource[]; notConnected: string[] } {
  const loaded: LoadedSource[] = [];
  const notConnected: string[] = [];
  for (const key of VAULT_SOURCE_KEYS) {
    const file = join(vaultDir, 'raw', `${key}.jsonl`);
    if (!existsSync(file)) {
      notConnected.push(key);
      continue;
    }
    const records: IntegrationRecord[] = [];
    const lines = readFileSync(file, 'utf8').split('\n');
    for (const line of lines) {
      if (records.length >= maxRecords) break;
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line) as IntegrationRecord);
      } catch {
        // 壊れた行はスキップ（append-only vaultの部分書き込み耐性）
      }
    }
    loaded.push({ key, records });
  }
  return { loaded, notConnected };
}

/**
 * 横断検索。ANDに近い挙動: トークンの一致数でスコアリングし、
 * 2トークン以上（またはクエリが1トークンなら1）一致した行のみ返す。
 */
export function searchKnowledge(
  query: string,
  options: { vaultDir?: string; limit?: number; sourceKey?: string } = {}
): KnowledgeSearchResult {
  const tokens = tokenizeQuery(query);
  const limit = options.limit ?? 20;
  const { loaded, notConnected } = loadVaultSources(options.vaultDir);
  const sources: KnowledgeSearchResult['sources'] = [];
  const scored: (KnowledgeHit & { score: number })[] = [];
  const required = Math.min(2, tokens.length);

  for (const { key, records } of loaded) {
    if (options.sourceKey && key !== options.sourceKey) continue;
    let hits = 0;
    for (const record of records) {
      const fields = Object.entries(record.raw as Record<string, unknown>).map(
        ([k, v]) => [k, String(v ?? '')] as const
      );
      const haystack = fields.map(([, v]) => v).join(' ');
      const matched = tokens.filter((t) => haystack.includes(t));
      if (matched.length < required) continue;
      hits += 1;
      scored.push({
        sourceSystem: record.sourceSystem,
        sourceRecordId: record.sourceRecordId,
        sourceSheet: record.sourceSheet,
        sourceRow: record.sourceRow,
        snippet: fields
          .filter(([, v]) => matched.some((t) => v.includes(t)))
          .slice(0, 4)
          .map(([k, v]) => `${k}: ${v.slice(0, 80)}`),
        matchedTokens: matched,
        linkConfidence: 'LOW',
        evidence: record.evidence,
        syncedAt: record.syncedAt,
        score: matched.length
      });
    }
    sources.push({ key, status: 'SEARCHED', scanned: records.length, hits });
  }
  for (const key of notConnected) {
    if (options.sourceKey && key !== options.sourceKey) continue;
    sources.push({ key, status: 'NOT_CONNECTED', scanned: 0, hits: 0 });
  }

  scored.sort((a, b) => b.score - a.score);
  return {
    query,
    tokens,
    hits: scored.slice(0, limit).map(({ score: _score, ...hit }) => hit),
    sources,
    note: '名称一致は候補（LOW）です。確定の紐付けではありません。未接続Sourceは0件と断定していません。'
  };
}
