/**
 * lcc-lineworks-relay（Cloud Run最小Webhookサービス・依存ゼロ）。
 *
 * 公開エンドポイント: POST /lineworks/callback のみ。
 * - UIなし・Cookie/LCC token認証なし・GETで情報を返さない・任意APIへのプロキシ禁止
 * - Bot SecretはSecret Manager経由の環境変数（LINEWORKS_BOT_SECRET）。ログへ本文・署名・Secretを出さない
 * - 正常イベントのみPub/Sub topic（PUBSUB_TOPIC=projects/<p>/topics/lcc-lineworks-events）へpublishし即200
 * - 解析・AI判断・LINE WORKSへの送信は行わない（将来送信を作る場合も坂本社長承認必須）
 * - Pub/Sub認証はCloud Runメタデータサーバーのaccess token（追加依存なし）
 */
import { createServer } from 'node:http';
import { decideRelay, createSeenCache, MAX_BODY_BYTES } from './relayCore.mjs';
import { captureDurably } from './durableCapture.mjs';

const PORT = Number(process.env.PORT ?? 8080);
const TOPIC = process.env.PUBSUB_TOPIC ?? '';
const BOT_SECRET = process.env.LINEWORKS_BOT_SECRET ?? '';
const ALLOWED_BOT_IDS = (process.env.LINEWORKS_ALLOWED_BOT_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
// 耐久outbox（GCS bucket名）。LINE WORKSは再送しないため、publish失敗イベントの最後の受け皿
const OUTBOX_BUCKET = process.env.LINEWORKS_OUTBOX_BUCKET ?? '';
const seen = createSeenCache();

async function metadataToken() {
  const res = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
    headers: { 'Metadata-Flavor': 'Google' }
  });
  if (!res.ok) throw new Error(`metadata token ${res.status}`);
  const body = await res.json();
  return body.access_token;
}

async function publish(data, attributes) {
  const token = await metadataToken();
  const res = await fetch(`https://pubsub.googleapis.com/v1/${TOPIC}:publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages: [{ data: Buffer.from(data).toString('base64'), attributes }] })
  });
  if (!res.ok) throw new Error(`publish ${res.status}`);
}

/** 耐久outbox: GCSへイベントJSONを保存（後続処理=LCC側drainが必ず取り込む） */
async function outboxSave(data, attributes) {
  if (!OUTBOX_BUCKET) throw new Error('NOT_CONFIGURED');
  const token = await metadataToken();
  const objectName = `lineworks-outbox/${Date.now()}-${attributes.contentHash}.json`;
  const res = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${OUTBOX_BUCKET}/o?uploadType=media&name=${encodeURIComponent(objectName)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ attributes, data })
    }
  );
  if (!res.ok) throw new Error(`outbox ${res.status}`);
}

const server = createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/lineworks/callback') {
    res.writeHead(404).end(); // GETで情報を返さない
    return;
  }
  const chunks = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BODY_BYTES) { res.writeHead(413).end(); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', async () => {
    if (res.writableEnded) return;
    const rawBody = Buffer.concat(chunks).toString('utf8');
    const decision = decideRelay({
      rawBody,
      botIdHeader: req.headers['x-works-botid'],
      signatureHeader: req.headers['x-works-signature'],
      botSecret: BOT_SECRET,
      allowedBotIds: ALLOWED_BOT_IDS,
      seenRecently: (k) => seen.has(k) // 照会のみ（処理済み登録はpublish成功後）
    });
    if (decision.status !== 200 || !decision.publish) {
      // 理由コードのみログ（本文・署名は出さない）
      console.log(JSON.stringify({ at: new Date().toISOString(), status: decision.status, reason: decision.reason }));
      res.writeHead(decision.status).end();
      return;
    }
    // LINE WORKSはCallback失敗時に再送しない。受理した1リクエストをここで必ず耐久化する:
    // publish内部再試行（3回）→ 失敗時は耐久outbox（GCS）→ 両方失敗のみ500（監視対象の異常）
    const captured = await captureDurably({
      publish: () => publish(decision.publish.data, decision.publish.attributes),
      outbox: OUTBOX_BUCKET ? () => outboxSave(decision.publish.data, decision.publish.attributes) : undefined
    });
    if (captured.outcome === 'FAILED') {
      console.log(JSON.stringify({ at: new Date().toISOString(), status: 500, reason: `capture failed after ${captured.publishAttempts} attempts` }));
      res.writeHead(500).end();
      return;
    }
    if (decision.seenKey) seen.add(decision.seenKey); // 耐久確保後のみ処理済み登録
    if (captured.outcome === 'OUTBOXED') {
      console.log(JSON.stringify({ at: new Date().toISOString(), status: 200, reason: 'outboxed (publish degraded)' }));
    }
    res.writeHead(200).end('ok');
  });
});

server.listen(PORT, () => console.log(JSON.stringify({ at: new Date().toISOString(), msg: `relay listening :${PORT}` })));
