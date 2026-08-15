import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { processInboundEvent, recordOutboundAwaitingReply, sensitivityOf } from '../../../src/command/intelligence/inboundPipeline.js';
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
    expect(info.createdFact!.approvalState).toBe('CANDIDATE'); // §F: 外部一般情報をFACT/AUTO確定しない
    expect(info.createdFact!.evidence[0].trust).toBe('EXTERNAL_CLAIM');
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

  it('E2E-4: こちらが送った質問の記録（watchKey）に基づき、相手の実返信で該当の返信待ちだけ再開する（§D）', () => {
    const s = new IntelligenceStore(tmp());
    // AWAITING_REPLYの根拠は「こちらが質問を送った記録+watchKey」
    recordOutboundAwaitingReply(s, { companyId: 'lcc', title: '山田様邸 日程のご確認', watchKey: 'gmail:thread-1' });
    expect(s.actions()[0].status).toBe('WAITING_EXTERNAL');
    const reply = processInboundEvent(s, ev({ externalId: 'q2', text: '確認しました、日程は問題ありません', content: { q: 2 }, watchKey: 'gmail:thread-1' }));
    expect(reply.resumedActions).toBe(1); // gmailはthread単位で特定できるため再開
    expect(s.actions().find((a) => a.title.startsWith('返答待ち'))!.status).toBe('GATHERING_INFORMATION');
  });

  it('E2E-4b: LINE WORKS同一roomの無関係メッセージでは全タスクを再開しない（Entity照合必須・§D）', () => {
    const s = new IntelligenceStore(tmp());
    recordOutboundAwaitingReply(s, {
      companyId: 'lcc', title: '山田様邸 追加工事の回答待ち', watchKey: 'lineworks:room-1',
      entities: [{ entityType: 'project', entityId: 'name:山田様邸', name: '山田様邸' }]
    });
    recordOutboundAwaitingReply(s, {
      companyId: 'lcc', title: '佐藤様 見積の回答待ち', watchKey: 'lineworks:room-1',
      entities: [{ entityType: 'customer', entityId: 'name:佐藤様', name: '佐藤様' }]
    });
    // 無関係メッセージ（Entity一致なし）→ どれも再開しない
    const noise = processInboundEvent(s, ev({ source: 'lineworks', externalId: 'n1', text: '本日の朝礼は8時からです', content: { n: 1 }, watchKey: 'lineworks:room-1' }));
    expect(noise.resumedActions).toBe(0);
    // 山田様邸に関する実返信 → 該当1件だけ再開（佐藤様の分は待機のまま）
    const reply = processInboundEvent(s, ev({ source: 'lineworks', externalId: 'n2', text: '山田様邸の件、追加工事OKです', content: { n: 2 }, watchKey: 'lineworks:room-1' }));
    expect(reply.resumedActions).toBe(1);
    expect(s.actions().find((a) => a.title.includes('山田様邸'))!.status).toBe('GATHERING_INFORMATION');
    expect(s.actions().find((a) => a.title.includes('佐藤様'))!.status).toBe('WAITING_EXTERNAL');
  });

  it('障害注入E2E: RawEvent保存後にActionItem作成が失敗しても、再実行でRECOVEREDとなり派生処理が完成する（Inbound完全性）', () => {
    const s = new IntelligenceStore(tmp());
    const input = ev({ text: '現場で事故が発生しました。至急ご判断ください', content: { crash: 1 } });
    // 1回目: addActionが必ず失敗する（RawEvent+DecisionCase保存後・ActionItem作成前のクラッシュを注入）
    const originalAddAction = s.addAction.bind(s);
    s.addAction = () => { throw new Error('injected crash before action persist'); };
    expect(() => processInboundEvent(s, input)).toThrow('injected crash');
    expect(s.rawEvents()).toHaveLength(1); // RawEventは保存済み
    expect(s.cases()).toHaveLength(1); // caseは保存済み
    expect(s.actions()).toHaveLength(0); // actionが欠けた部分障害状態
    // 2回目（再実行）: DEDUPLICATEDで終了せず、欠けたActionItemだけを再開作成する
    s.addAction = originalAddAction;
    const r2 = processInboundEvent(s, input);
    expect(r2.outcome).toBe('RECOVERED');
    expect(r2.createdCase).toBeNull(); // 既存caseは再利用（二重作成しない）
    expect(r2.createdAction!.status).toBe('WAITING_PRESIDENT');
    expect(r2.createdAction!.relatedCaseId).toBe(s.cases()[0].caseId); // 既存caseへ接続
    expect(s.rawEvents()).toHaveLength(1); // 最終状態: RawEvent 1件
    expect(s.cases()).toHaveLength(1); // DecisionCase 1件
    expect(s.actions()).toHaveLength(1); // ActionItem 1件
    // 3回目: 完全な状態ではDEDUPLICATED（重複作成なし）
    expect(processInboundEvent(s, input).outcome).toBe('DEDUPLICATED');
    expect(s.actions()).toHaveLength(1);
  });

  it('障害注入E2E: DecisionCase作成自体が失敗した場合も再実行でcase+actionが揃う', () => {
    const s = new IntelligenceStore(tmp());
    const input = ev({ externalId: 'crash2', text: '未入金です。至急確認をお願いします', content: { crash: 2 } });
    const originalAddCase = s.addCase.bind(s);
    s.addCase = () => { throw new Error('injected crash before case persist'); };
    expect(() => processInboundEvent(s, input)).toThrow('injected crash');
    expect(s.rawEvents()).toHaveLength(1);
    expect(s.cases()).toHaveLength(0);
    s.addCase = originalAddCase;
    const r = processInboundEvent(s, input);
    expect(r.outcome).toBe('RECOVERED');
    expect(s.cases()).toHaveLength(1);
    expect(s.actions()).toHaveLength(1);
  });

  it('機密区分: 人事・給与・個人情報は外部Provider送信不可と判定する', () => {
    expect(sensitivityOf('社員の給与改定について').sensitive).toBe(true);
    expect(sensitivityOf('外構工事の見積').sensitive).toBe(false);
    const s = new IntelligenceStore(tmp());
    const r = processInboundEvent(s, ev({ externalId: 'sens', text: '給与振込口座番号の変更をお願いします', content: { s: 1 } }));
    expect(r.sensitive).toBe(true);
  });
});
