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
 *   注意: この関数は「照会のみ」であること。処理済み登録はpublish成功後に呼出側が行う
 *   （publish失敗後のLINE WORKS再送をduplicateとして破棄しないため＝イベント欠落0件）。
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
    return { status: 200, reason: 'duplicate (already published)' }; // 再送には200（LINE WORKS再送を止める）
  }
  return {
    status: 200,
    reason: 'accepted',
    seenKey, // publish成功後にのみ呼出側がadd()する（失敗時は未登録のまま→再送を受理できる）
    publish: {
      data: input.rawBody,
      attributes: { botId: input.botIdHeader, eventKey, contentHash, receivedAt: new Date(nowMs).toISOString() }
    }
  };
}

/**
 * 簡易LRU（インスタンス内リプレイ検知。完全な重複排除はLCC側RawEventが担保）。
 * has()は照会のみ・add()はpublish成功後にのみ呼ぶ（publish失敗イベントを処理済みにしない）。
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
