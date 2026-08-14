import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { processInboundEvent, sensitivityOf } from '../../../src/command/intelligence/inboundPipeline.js';
import { IntelligenceStore } from '../../../src/command/intelligence/store.js';
import type { InboundEventInput } from '../../../src/command/intelligence/inboundPipeline.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'lcc-inb-'));
const ev = (over: Partial<InboundEventInput> = {}): InboundEventInput => ({
  companyId: 'lcc', source: 'gmail', externalId: 'msg-1',
  content: { body: over.text ?? 'テスト' }, text: 'テスト',
  fromLabel: '山田様', watchKey: 'gmail:thread-1', ...over
});

describe('共通Inbound Event Pipeline（構成訂正§3）', () => {
  it('社長判断が必要な内容はDecisionCase+WAITING_PRESIDENTタスクを生成する', () => {
    const s = new IntelligenceStore(tmp());
    const r = processInboundEvent(s, ev({ text: '山田様邸の追加工事で金額変更のご相談です。至急ご判断ください', content: { b: 1 } }));
    expect(r.classification.kind).toBe('PRESIDENT_DECISION');
    expect(r.createdCase).not.toBeNull();
    expect(r.createdCase!.entities.some((e) => e.name === '山田様邸')).toBe(true); // Entity解決
    expect(r.createdAction!.status).toBe('WAITING_PRESIDENT');
    expect(r.createdCase!.evidence[0].trust).toBe('EXTERNAL_CLAIM');
  });

  it('情報のみはKnowledge、依頼はActionItem、広告は理由付き除外（タスク化しない）', () => {
    const s = new IntelligenceStore(tmp());
    const info = processInboundEvent(s, ev({ externalId: 'm-info', text: '本日の作業完了しました', content: { a: 1 } }));
    expect(info.createdFact).not.toBeNull();
    expect(info.createdAction).toBeNull();
    const act = processInboundEvent(s, ev({ externalId: 'm-act', text: '見積の作成をお願いします', content: { a: 2 } }));
    expect(act.createdAction!.status).toBe('GATHERING_INFORMATION');
    const ex = processInboundEvent(s, ev({ externalId: 'm-ad', text: '夏の特別キャンペーンのご案内', content: { a: 3 } }));
    expect(ex.excludedReason).toContain('広告');
    expect(ex.createdAction).toBeNull();
    expect(ex.createdCase).toBeNull();
    expect(s.rawEvents()).toHaveLength(3); // 除外も原文は監査用に保存
  });

  it('同一イベント再送では重複タスクを作らない（§6-4受入試験）', () => {
    const s = new IntelligenceStore(tmp());
    const input = ev({ text: '請求書の送付をお願いします', content: { fixed: true } });
    const r1 = processInboundEvent(s, input);
    const r2 = processInboundEvent(s, input);
    expect(r1.outcome).toBe('PROCESSED');
    expect(r2.outcome).toBe('DEDUPLICATED');
    expect(r2.createdAction).toBeNull();
    expect(s.actions()).toHaveLength(1);
  });

  it('相手の返信でWAITING_EXTERNALが自動再開する（§6-6受入試験）', () => {
    const s = new IntelligenceStore(tmp());
    processInboundEvent(s, ev({ externalId: 'q1', text: '先方からのご返信をお待ちしている状況です', content: { q: 1 } }));
    expect(s.actions()[0].status).toBe('WAITING_EXTERNAL');
    const reply = processInboundEvent(s, ev({ externalId: 'q2', text: '確認しました、日程は問題ありません', content: { q: 2 }, watchKey: 'gmail:thread-1' }));
    expect(reply.resumedActions).toBe(1);
    expect(s.actions().find((a) => a.title.startsWith('返答待ち'))!.status).toBe('GATHERING_INFORMATION');
  });

  it('機密区分: 人事・給与・個人情報は外部Provider送信不可と判定する', () => {
    expect(sensitivityOf('社員の給与改定について').sensitive).toBe(true);
    expect(sensitivityOf('外構工事の見積').sensitive).toBe(false);
    const s = new IntelligenceStore(tmp());
    const r = processInboundEvent(s, ev({ externalId: 'sens', text: '給与振込口座番号の変更をお願いします', content: { s: 1 } }));
    expect(r.sensitive).toBe(true);
  });
});
