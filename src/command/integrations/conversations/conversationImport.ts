/**
 * ChatGPT / Gemini 対話履歴の正式export importer（夜間統合運転 §13）。
 *
 * - ChatGPT: 設定→データエクスポートのZIP内 conversations.json
 * - Gemini: Google Takeout（My Activity JSON）
 * - ブラウザ内部・非公開APIは扱わない。原本はread-onlyで読み、hashを記録する。
 * - 保存先: data/conversation_archive/<provider>/YYYY/MM/<conversationId>.json
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface CanonicalMessage {
  messageId: string;
  role: 'user' | 'assistant' | 'system' | 'tool' | 'unknown';
  createdAt: string | null;
  text: string;
  attachments: string[];
}

export interface CanonicalConversation {
  provider: 'chatgpt' | 'gemini';
  conversationId: string;
  title: string;
  createdAt: string | null;
  updatedAt: string | null;
  messages: CanonicalMessage[];
  /** 重複排除用の内容ハッシュ（provider+conversationId+メッセージ内容） */
  canonicalHash: string;
  evidence: {
    sourceExportFile: string;
    sourceExportSha256: string;
    importedAt: string;
  };
}

export function canonicalHashOf(provider: string, conversationId: string, messages: CanonicalMessage[]): string {
  const key = `${provider}|${conversationId}|${messages.map((m) => `${m.role}:${m.text}`).join('')}`;
  return createHash('sha256').update(key).digest('hex');
}

function toIso(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  if (typeof value === 'string' && value) {
    const t = Date.parse(value);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  return null;
}

/** ChatGPT export（conversations.json）→ canonical変換 */
export function parseChatgptExport(json: unknown, sourceFile: string, sourceSha256: string, importedAt: string): CanonicalConversation[] {
  if (!Array.isArray(json)) throw new Error('conversations.json の形式が想定と異なります（配列でない）');
  const out: CanonicalConversation[] = [];
  for (const conv of json as Array<Record<string, unknown>>) {
    const mapping = (conv.mapping ?? {}) as Record<string, Record<string, unknown>>;
    const messages: CanonicalMessage[] = [];
    for (const [nodeId, node] of Object.entries(mapping)) {
      const msg = node.message as Record<string, unknown> | undefined;
      if (!msg) continue;
      const content = msg.content as Record<string, unknown> | undefined;
      const parts = Array.isArray(content?.parts) ? (content?.parts as unknown[]) : [];
      const text = parts.filter((p) => typeof p === 'string').join('\n').trim();
      if (!text) continue;
      const author = (msg.author as Record<string, unknown> | undefined)?.role;
      messages.push({
        messageId: String(msg.id ?? nodeId),
        role: author === 'user' || author === 'assistant' || author === 'system' || author === 'tool' ? author : 'unknown',
        createdAt: toIso(msg.create_time),
        text,
        attachments: []
      });
    }
    messages.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
    const conversationId = String(conv.conversation_id ?? conv.id ?? '');
    if (!conversationId || messages.length === 0) continue;
    out.push({
      provider: 'chatgpt',
      conversationId,
      title: String(conv.title ?? '（無題）'),
      createdAt: toIso(conv.create_time),
      updatedAt: toIso(conv.update_time),
      messages,
      canonicalHash: canonicalHashOf('chatgpt', conversationId, messages),
      evidence: { sourceExportFile: sourceFile, sourceExportSha256: sourceSha256, importedAt }
    });
  }
  return out;
}

/** Gemini（Google Takeout MyActivity.json）→ canonical変換 */
export function parseGeminiTakeout(json: unknown, sourceFile: string, sourceSha256: string, importedAt: string): CanonicalConversation[] {
  if (!Array.isArray(json)) throw new Error('Takeout MyActivity の形式が想定と異なります（配列でない）');
  const out: CanonicalConversation[] = [];
  for (const item of json as Array<Record<string, unknown>>) {
    const title = String(item.title ?? '');
    const time = toIso(item.time);
    const prompt = title.replace(/^(Prompted|プロンプト:?)\s*/i, '').trim();
    if (!prompt) continue;
    const messages: CanonicalMessage[] = [
      { messageId: 'prompt', role: 'user', createdAt: time, text: prompt, attachments: [] }
    ];
    const subtitles = Array.isArray(item.subtitles) ? (item.subtitles as Array<Record<string, unknown>>) : [];
    const responseText = subtitles.map((s) => String(s.name ?? '')).filter(Boolean).join('\n');
    if (responseText) {
      messages.push({ messageId: 'response', role: 'assistant', createdAt: time, text: responseText, attachments: [] });
    }
    const conversationId = createHash('sha256').update(`${time}|${prompt}`).digest('hex').slice(0, 24);
    out.push({
      provider: 'gemini',
      conversationId,
      title: prompt.slice(0, 80),
      createdAt: time,
      updatedAt: time,
      messages,
      canonicalHash: canonicalHashOf('gemini', conversationId, messages),
      evidence: { sourceExportFile: sourceFile, sourceExportSha256: sourceSha256, importedAt }
    });
  }
  return out;
}

export interface ArchiveResult {
  written: number;
  duplicates: number;
  archiveDir: string;
}

/** canonical会話をarchiveへ格納（append-only・既存canonicalHashはスキップ） */
export function archiveConversations(baseDir: string, conversations: CanonicalConversation[]): ArchiveResult {
  let written = 0;
  let duplicates = 0;
  const root = join(baseDir, 'conversation_archive');
  for (const conv of conversations) {
    const ym = (conv.createdAt ?? '9999-99').slice(0, 7).split('-');
    const dir = join(root, conv.provider, ym[0] ?? '9999', ym[1] ?? '99');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${conv.conversationId}.json`);
    if (existsSync(file)) {
      try {
        const existing = JSON.parse(readFileSync(file, 'utf8')) as CanonicalConversation;
        if (existing.canonicalHash === conv.canonicalHash) {
          duplicates += 1;
          continue;
        }
      } catch {
        // 壊れたファイルは上書きで復旧
      }
    }
    writeFileSync(file, `${JSON.stringify(conv, null, 2)}\n`, 'utf8');
    written += 1;
  }
  return { written, duplicates, archiveDir: root };
}

/** inbox内のexportファイル（conversations.json / MyActivity*.json / ZIP展開済み）を処理 */
export async function importConversationExports(baseDir: string, importedAt: string): Promise<{
  chatgpt: ArchiveResult | null;
  gemini: ArchiveResult | null;
  errors: string[];
}> {
  const { readdirSync, renameSync } = await import('node:fs');
  const errors: string[] = [];
  let chatgpt: ArchiveResult | null = null;
  let gemini: ArchiveResult | null = null;
  for (const provider of ['chatgpt', 'gemini'] as const) {
    const inbox = join(baseDir, 'import', 'conversations', provider, 'inbox');
    const processed = join(baseDir, 'import', 'conversations', provider, 'processed');
    const rejected = join(baseDir, 'import', 'conversations', provider, 'rejected');
    mkdirSync(inbox, { recursive: true });
    mkdirSync(processed, { recursive: true });
    mkdirSync(rejected, { recursive: true });
    for (const file of readdirSync(inbox)) {
      const filePath = join(inbox, file);
      try {
        const buf = readFileSync(filePath);
        const sha = createHash('sha256').update(buf).digest('hex');
        const json = JSON.parse(buf.toString('utf8')) as unknown;
        const conversations =
          provider === 'chatgpt'
            ? parseChatgptExport(json, file, sha, importedAt)
            : parseGeminiTakeout(json, file, sha, importedAt);
        const result = archiveConversations(baseDir, conversations);
        if (provider === 'chatgpt') chatgpt = result;
        else gemini = result;
        renameSync(filePath, join(processed, file));
      } catch (error) {
        errors.push(`${provider}/${file}: ${error instanceof Error ? error.message : String(error)}`);
        renameSync(filePath, join(rejected, file));
      }
    }
  }
  return { chatgpt, gemini, errors };
}
