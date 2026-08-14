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

const PORT = Number(process.env.PORT ?? 8080);
const TOPIC = process.env.PUBSUB_TOPIC ?? '';
const BOT_SECRET = process.env.LINEWORKS_BOT_SECRET ?? '';
const ALLOWED_BOT_IDS = (process.env.LINEWORKS_ALLOWED_BOT_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
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
    try {
      await publish(decision.publish.data, decision.publish.attributes);
      if (decision.seenKey) seen.add(decision.seenKey); // publish成功後のみ処理済み登録（失敗時は再送を受理）
      res.writeHead(200).end('ok'); // 後続処理を待たず即時200
    } catch (e) {
      // 処理済み登録しない→LINE WORKS再送が次回受理される（イベント欠落0件）
      console.log(JSON.stringify({ at: new Date().toISOString(), status: 500, reason: 'publish failed' }));
      res.writeHead(500).end();
    }
  });
});

server.listen(PORT, () => console.log(JSON.stringify({ at: new Date().toISOString(), msg: `relay listening :${PORT}` })));
