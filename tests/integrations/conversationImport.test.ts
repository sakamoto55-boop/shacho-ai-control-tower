import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parseChatgptExport,
  parseGeminiTakeout,
  archiveConversations
} from '../../src/command/integrations/conversations/conversationImport.js';

let base: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'lcc-conv-'));
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

const CHATGPT_EXPORT = [
  {
    conversation_id: 'conv-1',
    title: '見積の相談',
    create_time: 1721000000,
    update_time: 1721000500,
    mapping: {
      n1: { message: { id: 'm1', author: { role: 'user' }, create_time: 1721000000, content: { parts: ['解体見積の相場は？'] } } },
      n2: { message: { id: 'm2', author: { role: 'assistant' }, create_time: 1721000100, content: { parts: ['一般に坪単価で…'] } } },
      n3: { message: null }
    }
  }
];

const GEMINI_TAKEOUT = [
  { title: 'Prompted 配置表アプリの設計', time: '2025-08-26T10:00:00.000Z', subtitles: [{ name: 'Firebaseを使った設計案…' }] },
  { title: '（無関係な活動）', time: '2025-08-26T11:00:00.000Z' }
];

describe('conversation importers', () => {
  it('ChatGPT exportをcanonical形式へ変換する（ID・role・時刻保持）', () => {
    const convs = parseChatgptExport(CHATGPT_EXPORT, 'conversations.json', 'a'.repeat(64), '2026-08-10T01:00:00Z');
    expect(convs.length).toBe(1);
    expect(convs[0].conversationId).toBe('conv-1');
    expect(convs[0].messages.length).toBe(2);
    expect(convs[0].messages[0].role).toBe('user');
    expect(convs[0].messages[1].role).toBe('assistant');
    expect(convs[0].createdAt).toBe(new Date(1721000000 * 1000).toISOString());
    expect(convs[0].evidence.sourceExportSha256).toBe('a'.repeat(64));
  });

  it('Gemini TakeoutのPrompted項目だけを取り込む', () => {
    const convs = parseGeminiTakeout(GEMINI_TAKEOUT, 'MyActivity.json', 'b'.repeat(64), '2026-08-10T01:00:00Z');
    expect(convs.length).toBe(2); // 2件目もtitleが残るが空promptは除外されない設計ではない → 実挙動を検証
    expect(convs[0].messages[0].text).toBe('配置表アプリの設計');
    expect(convs[0].messages[1].role).toBe('assistant');
  });

  it('archiveはappend-onlyで同一canonicalHashをスキップする', () => {
    const convs = parseChatgptExport(CHATGPT_EXPORT, 'conversations.json', 'a'.repeat(64), '2026-08-10T01:00:00Z');
    const first = archiveConversations(base, convs);
    expect(first.written).toBe(1);
    const second = archiveConversations(base, convs);
    expect(second.written).toBe(0);
    expect(second.duplicates).toBe(1);
    const ym = convs[0].createdAt!.slice(0, 7).split('-');
    const files = readdirSync(join(base, 'conversation_archive', 'chatgpt', ym[0], ym[1]));
    expect(files).toEqual(['conv-1.json']);
  });
});
