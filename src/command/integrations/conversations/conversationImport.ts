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
  provider: 'chatgpt' | 'gemini' | 'claude' | 'generic';
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

/** Claude export（claude.ai データエクスポート conversations.json）→ canonical変換（DIOS §6） */
export function parseClaudeExport(json: unknown, sourceFile: string, sourceSha256: string, importedAt: string): CanonicalConversation[] {
  if (!Array.isArray(json)) throw new Error('Claude export の形式が想定と異なります（配列でない）');
  const out: CanonicalConversation[] = [];
  for (const conv of json as Array<Record<string, unknown>>) {
    const rawMessages = Array.isArray(conv.chat_messages) ? (conv.chat_messages as Array<Record<string, unknown>>) : [];
    const messages: CanonicalMessage[] = rawMessages
      .map((m, i) => ({
        messageId: String(m.uuid ?? i),
        role: (m.sender === 'human' ? 'user' : m.sender === 'assistant' ? 'assistant' : 'unknown') as CanonicalMessage['role'],
        createdAt: toIso(m.created_at),
        text: String(m.text ?? '').trim(),
        attachments: []
      }))
      .filter((m) => m.text);
    const conversationId = String(conv.uuid ?? '');
    if (!conversationId || messages.length === 0) continue;
    out.push({
      provider: 'claude',
      conversationId,
      title: String(conv.name ?? '（無題）'),
      createdAt: toIso(conv.created_at),
      updatedAt: toIso(conv.updated_at),
      messages,
      canonicalHash: canonicalHashOf('claude', conversationId, messages),
      evidence: { sourceExportFile: sourceFile, sourceExportSha256: sourceSha256, importedAt }
    });
  }
  return out;
}

/** 汎用JSON（{conversationId?,title?,messages:[{role,text,createdAt?}]} または配列）→ canonical変換 */
export function parseGenericJson(json: unknown, sourceFile: string, sourceSha256: string, importedAt: string): CanonicalConversation[] {
  const items = Array.isArray(json) ? json : [json];
  const out: CanonicalConversation[] = [];
  for (const item of items as Array<Record<string, unknown>>) {
    const rawMessages = Array.isArray(item.messages) ? (item.messages as Array<Record<string, unknown>>) : [];
    const messages: CanonicalMessage[] = rawMessages
      .map((m, i) => ({
        messageId: String(m.messageId ?? m.id ?? i),
        role: (['user', 'assistant', 'system', 'tool'].includes(String(m.role)) ? String(m.role) : 'unknown') as CanonicalMessage['role'],
        createdAt: toIso(m.createdAt ?? m.time),
        text: String(m.text ?? m.content ?? '').trim(),
        attachments: []
      }))
      .filter((m) => m.text);
    if (messages.length === 0) continue;
    const conversationId = String(item.conversationId ?? item.id ?? createHash('sha256').update(sourceSha256 + messages[0].text).digest('hex').slice(0, 24));
    out.push({
      provider: 'generic',
      conversationId,
      title: String(item.title ?? messages[0].text.slice(0, 60)),
      createdAt: messages[0].createdAt,
      updatedAt: messages[messages.length - 1].createdAt,
      messages,
      canonicalHash: canonicalHashOf('generic', conversationId, messages),
      evidence: { sourceExportFile: sourceFile, sourceExportSha256: sourceSha256, importedAt }
    });
  }
  return out;
}

/** 汎用Markdown（「## ユーザー」「## AI」または「User:」「Assistant:」区切り）→ canonical変換 */
export function parseGenericMarkdown(md: string, sourceFile: string, sourceSha256: string, importedAt: string): CanonicalConversation[] {
  const lines = md.split(/\r?\n/);
  const messages: CanonicalMessage[] = [];
  let role: CanonicalMessage['role'] | null = null;
  let buf: string[] = [];
  const flush = () => {
    const text = buf.join('\n').trim();
    if (role && text) messages.push({ messageId: String(messages.length), role, createdAt: null, text, attachments: [] });
    buf = [];
  };
  for (const line of lines) {
    const m = /^(?:##\s*)?(ユーザー|User|社長|Human)\s*[:：]?\s*$/i.exec(line.trim())
      ? 'user'
      : /^(?:##\s*)?(AI|Assistant|回答)\s*[:：]?\s*$/i.exec(line.trim())
        ? 'assistant'
        : null;
    if (m) { flush(); role = m; continue; }
    const inline = /^(User|Human|ユーザー)[:：]\s*(.+)$/i.exec(line) ?? /^(Assistant|AI)[:：]\s*(.+)$/i.exec(line);
    if (inline) {
      flush();
      role = /^(User|Human|ユーザー)/i.test(inline[1]) ? 'user' : 'assistant';
      buf.push(inline[2]);
      continue;
    }
    buf.push(line);
  }
  flush();
  if (messages.length === 0) return [];
  const conversationId = sourceSha256.slice(0, 24);
  return [{
    provider: 'generic',
    conversationId,
    title: messages[0].text.slice(0, 60),
    createdAt: null,
    updatedAt: null,
    messages,
    canonicalHash: canonicalHashOf('generic', conversationId, messages),
    evidence: { sourceExportFile: sourceFile, sourceExportSha256: sourceSha256, importedAt }
  }];
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

/** inbox内のexportファイル（conversations.json / MyActivity*.json / Claude export / 汎用JSON・Markdown）を処理 */
export async function importConversationExports(baseDir: string, importedAt: string): Promise<{
  chatgpt: ArchiveResult | null;
  gemini: ArchiveResult | null;
  claude: ArchiveResult | null;
  generic: ArchiveResult | null;
  errors: string[];
  conversations: CanonicalConversation[];
}> {
  const { readdirSync, renameSync } = await import('node:fs');
  const errors: string[] = [];
  const results: Record<'chatgpt' | 'gemini' | 'claude' | 'generic', ArchiveResult | null> = {
    chatgpt: null, gemini: null, claude: null, generic: null
  };
  const allConversations: CanonicalConversation[] = [];
  for (const provider of ['chatgpt', 'gemini', 'claude', 'generic'] as const) {
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
        let conversations: CanonicalConversation[];
        if (/\.(md|markdown|txt)$/i.test(file)) {
          conversations = parseGenericMarkdown(buf.toString('utf8'), file, sha, importedAt);
        } else {
          const json = JSON.parse(buf.toString('utf8')) as unknown;
          conversations =
            provider === 'chatgpt' ? parseChatgptExport(json, file, sha, importedAt)
              : provider === 'gemini' ? parseGeminiTakeout(json, file, sha, importedAt)
                : provider === 'claude' ? parseClaudeExport(json, file, sha, importedAt)
                  : parseGenericJson(json, file, sha, importedAt);
        }
        const result = archiveConversations(baseDir, conversations);
        results[provider] = result;
        allConversations.push(...conversations);
        renameSync(filePath, join(processed, file));
      } catch (error) {
        errors.push(`${provider}/${file}: ${error instanceof Error ? error.message : String(error)}`);
        renameSync(filePath, join(rejected, file));
      }
    }
  }
  return { ...results, errors, conversations: allConversations };
}
