import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryCommandRepository } from '../../../src/command/repositories/CommandRepository.js';
import {
  LearningSafetyError,
  MemoryService,
  resetMemorySeq,
  type NewMemoryInput
} from '../../../src/command/memory/store.js';
import type { Principal } from '../../../src/command/domain/types.js';

const NOW = '2026-08-08T00:00:00.000Z';
const PRESIDENT: Principal = { role: 'PRESIDENT', companyIds: [], label: '社長' };
const MANAGER: Principal = { role: 'MANAGER', companyIds: ['lcc'], label: '管理者' };

function input(overrides: Partial<NewMemoryInput>): NewMemoryInput {
  return {
    type: 'CONTEXT',
    statement: 'テスト記憶',
    entities: [],
    relations: [],
    layer: 'OPERATIONAL',
    sensitivity: 'NORMAL',
    companyId: 'lcc',
    source: 'CONVERSATION',
    sourceId: 'session-1',
    validFrom: '2026-08-08',
    confidence: 'MEDIUM',
    createdBy: 'user:社長',
    reviewStatus: 'AUTO',
    evidence: [{ label: '発言', value: 'テスト', source: '会話', asOf: NOW }],
    ...overrides
  };
}

describe('M: Memory Service（Learning Safety）', () => {
  let service: MemoryService;
  let repository: InMemoryCommandRepository;

  beforeEach(() => {
    resetMemorySeq();
    repository = new InMemoryCommandRepository();
    service = new MemoryService(repository);
  });

  it('AIの推測はFACTとして保存できない（根拠なし）', async () => {
    await expect(
      service.save(input({ type: 'FACT', createdBy: 'ai:curator', evidence: [] }), NOW)
    ).rejects.toThrow(LearningSafetyError);
  });

  it('AIは正式DECISIONを独断確定できない（PENDING_REVIEW必須）', async () => {
    await expect(
      service.save(input({ type: 'DECISION', createdBy: 'ai:curator', reviewStatus: 'AUTO' }), NOW)
    ).rejects.toThrow(/独断で確定/);
    const saved = await service.save(
      input({ type: 'DECISION', createdBy: 'ai:curator', reviewStatus: 'PENDING_REVIEW' }),
      NOW
    );
    expect(saved.record.reviewStatus).toBe('PENDING_REVIEW');
  });

  it('高機密情報（給与実額）は一般Memoryへ保存できない', async () => {
    await expect(
      service.save(input({ statement: '田中の月給は350,000円になった' }), NOW)
    ).rejects.toThrow(/高機密/);
    // SENSITIVE_REFでも実値は禁止（参照のみ）
    await expect(
      service.save(input({ statement: '田中の月給は350,000円', sensitivity: 'SENSITIVE_REF' }), NOW)
    ).rejects.toThrow(/実値/);
    // 参照情報のみならOK
    const ref = await service.save(
      input({
        statement: '田中の給与条件はPeople OS（正式ID）を参照',
        sensitivity: 'SENSITIVE_REF'
      }),
      NOW
    );
    expect(ref.record.sensitivity).toBe('SENSITIVE_REF');
  });

  it('外部調査由来はCOMPANY層に入らずEXTERNAL層へ強制される', async () => {
    const saved = await service.save(
      input({ type: 'FACT', source: 'EXTERNAL_RESEARCH', layer: 'COMPANY', sourceId: 'res-1' }),
      NOW
    );
    expect(saved.record.layer).toBe('EXTERNAL');
  });

  it('重複Memoryは追加せずEvidenceを追記する', async () => {
    const first = await service.save(input({ statement: '見積後の追客漏れが多い' }), NOW);
    const second = await service.save(input({ statement: '見積後の追客漏れが多い。' }), NOW);
    expect(second.mergedIntoExisting).toBe(true);
    expect(second.record.memoryId).toBe(first.record.memoryId);
    expect(second.record.evidence.length).toBe(2);
  });

  it('矛盾（同一subjectKey・異なる内容）は上書きせずConflictとして報告する', async () => {
    await service.save(
      input({ type: 'FACT', statement: '営業課長は田中である', subjectKey: 'person:営業課長' }),
      NOW
    );
    const conflicting = await service.save(
      input({ type: 'FACT', statement: '営業課長は藤井である', subjectKey: 'person:営業課長' }),
      NOW
    );
    expect(conflicting.conflictsWith).toHaveLength(1);
    // 両方保持されている（勝手に上書きしない）
    const all = await repository.getMemories();
    expect(
      all.filter((m) => m.status === 'ACTIVE' && m.subjectKey === 'person:営業課長')
    ).toHaveLength(2);

    // ユーザー判断で解決
    await service.resolveConflict(
      conflicting.record.memoryId,
      all.find((m) => m.statement.includes('田中'))!.memoryId,
      NOW,
      '最新の組織図に基づく'
    );
    const after = await repository.getMemories();
    expect(after.find((m) => m.statement.includes('田中'))?.status).toBe('SUPERSEDED');
  });

  it('訂正は履歴を失わない（SUPERSEDED→新ACTIVE、Temporal Retrieval可能）', async () => {
    const v1 = await service.save(
      input({
        type: 'DECISION',
        statement: '公共工事を主要チャネルとしない',
        validFrom: '2025-01-01'
      }),
      '2025-01-01T00:00:00.000Z'
    );
    const { old, replacement } = await service.correct(
      v1.record.memoryId,
      input({
        type: 'DECISION',
        statement: '特定分野の公共工事のみ積極受注する',
        validFrom: '2026-08-08'
      }),
      NOW,
      '方針変更',
      'SUPERSEDED'
    );
    expect(old.status).toBe('SUPERSEDED');
    expect(old.supersededBy).toBe(replacement.memoryId);

    // 現在有効なのはv2のみ
    const current = await service.search({ q: '公共工事' }, PRESIDENT);
    expect(current).toHaveLength(1);
    expect(current[0].statement).toContain('特定分野');

    // 2025年時点で有効だったのはv1（Temporal Retrieval）
    const past = await service.search({ q: '公共工事', validAt: '2025-06-01' }, PRESIDENT);
    expect(past).toHaveLength(1);
    expect(past[0].statement).toContain('主要チャネルとしない');

    // 変遷履歴
    const history = await service.history(replacement.memoryId);
    expect(history.map((m) => m.statement)).toEqual([
      '公共工事を主要チャネルとしない',
      '特定分野の公共工事のみ積極受注する'
    ]);
  });

  it('PRESIDENT層のMemoryはMANAGERから見えない（権限分離）', async () => {
    await service.save(
      input({ layer: 'PRESIDENT', statement: '経営者個人の判断メモ', companyId: 'lcc' }),
      NOW
    );
    expect(await service.search({ q: '判断メモ' }, PRESIDENT)).toHaveLength(1);
    expect(await service.search({ q: '判断メモ' }, MANAGER)).toHaveLength(0);
  });

  it('SENSITIVE_REFはMANAGERから見えない', async () => {
    await service.save(
      input({ sensitivity: 'SENSITIVE_REF', statement: '給与条件はPeople OS参照' }),
      NOW
    );
    expect((await service.search({ q: '給与条件' }, PRESIDENT)).length).toBe(1);
    expect((await service.search({ q: '給与条件' }, MANAGER)).length).toBe(0);
  });

  it('ArchiveはDECISION履歴を物理削除しない', async () => {
    const decision = await service.save(input({ type: 'DECISION', statement: '古い決定' }), NOW);
    await service.archive(decision.record.memoryId, NOW);
    const all = await repository.getMemories();
    const archived = all.find((m) => m.memoryId === decision.record.memoryId);
    expect(archived?.status).toBe('ARCHIVED');
    expect(archived?.statement).toBe('古い決定'); // 内容は保持
  });
});
