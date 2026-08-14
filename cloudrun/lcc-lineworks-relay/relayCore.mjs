/**
 * lcc-lineworks-relay コア判定（純関数・依存ゼロ）。
 *
 * Cloud Runで公開するのは POST /lineworks/callback 1本のみ。
 * このモジュールは「受理可否の判定」だけを行い、解析・AI判断・送信・プロキシは一切しない。
 * ログへ本文・署名・Secretを出さないため、判定結果はコードと短い理由のみ返す。
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const MAX_BODY_BYTES = 64 * 1024; // oversized body拒否
export const REPLAY_WINDOW_MS = 5 * 60_000; // timestamp許容窓

/** @typedef {{ status: number; reason: string; publish?: { data: string; attributes: Record<string,string> } }} RelayDecision */

/**
 * @param {object} input
 * @param {string} input.rawBody
 * @param {string|undefined} input.botIdHeader   X-WORKS-BotId
 * @param {string|undefined} input.signatureHeader X-WORKS-Signature (base64 HMAC-SHA256)
 * @param {string} input.botSecret  Secret Manager由来（ログへ出さない）
 * @param {string[]} input.allowedBotIds
 * @param {(key: string) => boolean} input.seenRecently  重複/リプレイ検知（event key既出ならtrue）。
 *   注意: この関数は「照会のみ」であること。処理済み登録は呼出側が**耐久的に確保できた後**
 *   （publish成功またはoutbox保存成功の後）にadd()する。
 *   前提: LINE WORKSはCallback失敗時に再送しない。失われたイベントは戻らないため、
 *   受理したリクエストは呼出側が publish内部再試行→outbox で必ず耐久化する責務を負う。
 * @param {number} [input.nowMs]
 * @returns {RelayDecision & { seenKey?: string }}
 */
export function decideRelay(input) {
  const nowMs = input.nowMs ?? Date.now();
  if (Buffer.byteLength(input.rawBody ?? '', 'utf8') > MAX_BODY_BYTES) {
    return { status: 413, reason: 'oversized body' };
  }
  if (!input.botIdHeader || !input.allowedBotIds.includes(input.botIdHeader)) {
    return { status: 403, reason: 'unknown bot id' };
  }
  if (!input.signatureHeader || !input.botSecret) {
    return { status: 401, reason: 'missing signature' };
  }
  const expected = createHmac('sha256', input.botSecret).update(input.rawBody).digest('base64');
  const sig = input.signatureHeader;
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return { status: 401, reason: 'invalid signature' };
  }
  let payload;
  try { payload = JSON.parse(input.rawBody); } catch { return { status: 400, reason: 'invalid json' }; }
  // timestamp検査（issuedTime/createdTimeのいずれか。無ければ通すがevent keyで重複排除）
  const ts = Date.parse(String(payload?.issuedTime ?? payload?.createdTime ?? payload?.content?.createdTime ?? ''));
  if (!Number.isNaN(ts) && Math.abs(nowMs - ts) > REPLAY_WINDOW_MS) {
    return { status: 401, reason: 'stale timestamp (replay?)' };
  }
  const contentHash = createHmac('sha256', 'dedupe').update(input.rawBody).digest('hex').slice(0, 32);
  const eventKey = String(payload?.eventId ?? payload?.content?.messageId ?? contentHash);
  const seenKey = `${input.botIdHeader}:${eventKey}`;
  if (input.seenRecently(seenKey)) {
    // 同一イベントの重複配信（マルチインスタンス等）への防御。LINE WORKSの「再送」は存在しない前提
    return { status: 200, reason: 'duplicate (already captured)' };
  }
  return {
    status: 200,
    reason: 'accepted',
    seenKey, // 呼出側がpublish成功またはoutbox保存成功の後にのみadd()する
    publish: {
      data: input.rawBody,
      attributes: { botId: input.botIdHeader, eventKey, contentHash, receivedAt: new Date(nowMs).toISOString() }
    }
  };
}

/**
 * 簡易LRU（インスタンス内の重複配信防御。完全な重複排除はLCC側RawEventが担保）。
 * has()は照会のみ・add()は耐久確保（publish成功/outbox保存成功）後にのみ呼ぶ。
 */
export function createSeenCache(max = 5000) {
  const seen = new Map();
  return {
    has(key) {
      return seen.has(key);
    },
    add(key) {
      seen.set(key, 1);
      if (seen.size > max) seen.delete(seen.keys().next().value);
    }
  };
}
