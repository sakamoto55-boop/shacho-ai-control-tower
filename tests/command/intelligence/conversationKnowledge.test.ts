import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseClaudeExport,
  parseGenericJson,
  parseGenericMarkdown
} from '../../../src/command/integrations/conversations/conversationImport.js';
import {
  answerFromKnowledge,
  extractEntities,
  ingestConversationKnowledge
} from '../../../src/command/intelligence/conversationKnowledge.js';
import { IntelligenceStore } from '../../../src/command/intelligence/store.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'lcc-convk-'));
const NOW = '2026-08-14T00:00:00.000Z';

describe('DIOS §6: 過去AI対話→会社知識（安全なテストデータ使用）', () => {
  it('Claude exportをcanonical化できる', () => {
    const convs = parseClaudeExport([
      {
        uuid: 'c-1', name: '山田邸の打合せ', created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T01:00:00Z',
        chat_messages: [
          { uuid: 'm1', sender: 'human', text: '山田邸の外構は9月開始で確定します。', created_at: '2026-07-01T00:10:00Z' },
          { uuid: 'm2', sender: 'assistant', text: '承知しました。', created_at: '2026-07-01T00:11:00Z' }
        ]
      }
    ], 'conversations.json', 'sha', NOW);
    expect(convs).toHaveLength(1);
    expect(convs[0].provider).toBe('claude');
    expect(convs[0].messages[0].role).toBe('user');
  });

  it('汎用JSONと汎用Markdownをcanonical化できる', () => {
    const j = parseGenericJson({ title: 'テスト', messages: [{ role: 'user', text: '見積は税込でお願いしたい' }] }, 'x.json', 'sha1', NOW);
    expect(j[0].provider).toBe('generic');
    const m = parseGenericMarkdown('User: 田中様邸は10月着工に決めた\nAssistant: 記録しました', 'x.md', 'sha2', NOW);
    expect(m[0].messages).toHaveLength(2);
    expect(m[0].messages[0].role).toBe('user');
  });

  it('知識抽出: 決定/好み/約束を抽出し、Entity（○○邸）へ紐付け、重要事実はCANDIDATE', () => {
    const store = new IntelligenceStore(tmp());
    const conv = parseClaudeExport([
      {
        uuid: 'c-2', name: '打合せ', created_at: NOW, updated_at: NOW,
        chat_messages: [
          { uuid: 'm1', sender: 'human', text: '山田邸の外構は9月開始で確定します。見積は税込表示が好み。8月20日までに提出を約束した。', created_at: NOW }
        ]
      }
    ], 'c.json', 'sha', NOW)[0];
    const r = ingestConversationKnowledge(store, conv);
    expect(r.extractedFacts.length).toBeGreaterThanOrEqual(3);
    const decided = r.extractedFacts.find((f) => f.kind === 'FACT');
    expect(decided?.entities[0]?.name).toBe('山田邸');
    expect(decided?.approvalState).toBe('CANDIDATE'); // 重要事実は承認候補
    const pref = r.extractedFacts.find((f) => f.kind === 'PREFERENCE');
    expect(pref?.approvalState).toBe('AUTO');
    // 冪等: 同一会話の再取込は再抽出しない
    const r2 = ingestConversationKnowledge(store, conv);
    expect(r2.rawDeduplicated).toBe(true);
    expect(r2.extractedFacts).toHaveLength(0);
  });

  it('E2E: import→質問に根拠付き回答→訂正後は新版を使用し旧版件数も分かる（§12-3/5）', () => {
    const store = new IntelligenceStore(tmp());
    const conv = parseGenericMarkdown('User: 山田邸の外構は9月開始で確定します\nAssistant: 了解', 'y.md', 'shaY', NOW)[0];
    const r = ingestConversationKnowledge(store, conv);
    const before = answerFromKnowledge(store, '山田邸');
    expect(before.found).toBe(true);
    expect(before.statements[0].statement).toContain('9月開始');
    expect(before.statements[0].evidence).toContain('ai-conversation:generic'); // 根拠付き
    // 訂正
    const oldFact = r.extractedFacts[0];
    store.correctFact(oldFact.factId, {
      companyId: 'lcc', statement: '山田邸の外構は10月開始（9月開始は誤り）',
      entities: extractEntities('山田邸'), evidence: oldFact.evidence, approvalState: 'CANDIDATE', sourceRawEventIds: oldFact.sourceRawEventIds
    });
    const after = answerFromKnowledge(store, '山田邸');
    expect(after.statements.some((s) => s.statement.includes('10月開始'))).toBe(true);
    expect(after.statements.some((s) => s.statement.includes('9月開始で確定'))).toBe(false); // 旧版は使わない
    expect(after.supersededCount).toBe(1); // 旧版の存在は履歴として分かる
  });
});
