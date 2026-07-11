import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AnalyzeMessageInput } from '../../src/domain/types.js';
import { MockAIProvider } from '../../src/ai/providers/MockAIProvider.js';
import { analyzeAndSaveMessage } from '../../src/jobs/analyzeIncomingMessages.js';
import { generateProblemDigest } from '../../src/reports/generateProblemDigest.js';
import { LocalRepository } from '../../src/repositories/LocalRepository.js';

const NOW = new Date('2026-07-10T09:00:00.000Z');

function lineworksMessage(overrides: Partial<AnalyzeMessageInput> & { text: string }): AnalyzeMessageInput {
  return {
    source: 'lineworks',
    receivedAt: '2026-07-01T00:00:00.000Z',
    senderName: '工務部',
    senderAddress: '',
    roomName: '現場ルーム',
    subject: '',
    ...overrides
  };
}

describe('generateProblemDigest', () => {
  let dir: string;
  let repo: LocalRepository;
  const provider = new MockAIProvider();

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'shacho-ai-digest-'));
    repo = new LocalRepository(join(dir, 'db.json'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('直近30日のLINE WORKS問題案件をカテゴリ別に集約する', async () => {
    // 入金遅延2件（DX候補の閾値2件以上を満たす）
    await analyzeAndSaveMessage(
      repo,
      lineworksMessage({
        externalMessageId: 'lw-1',
        text: 'D社の入金が予定日を過ぎても確認できない。確認お願いします。'
      }),
      provider
    );
    await analyzeAndSaveMessage(
      repo,
      lineworksMessage({
        externalMessageId: 'lw-2',
        receivedAt: '2026-07-05T00:00:00.000Z',
        text: 'E社も未入金です。回収の進め方を相談させてください。'
      }),
      provider
    );
    // 完了報告（問題ではない）
    await analyzeAndSaveMessage(
      repo,
      lineworksMessage({
        externalMessageId: 'lw-3',
        roomName: '工務部ルーム',
        text: '本日の作業完了しました。写真も共有済みです。'
      }),
      provider
    );

    const digest = await generateProblemDigest(repo, { now: NOW });

    expect(digest.source).toBe('lineworks');
    expect(digest.totalMessages).toBe(3);
    expect(digest.problemCount).toBe(2);

    const paymentCategory = digest.categories.find((c) => c.riskType === 'payment_delay');
    expect(paymentCategory?.count).toBe(2);
    expect(paymentCategory?.examples.length).toBeGreaterThan(0);

    const paymentDx = digest.dxCandidates.find((c) => c.theme.includes('入金'));
    expect(paymentDx).toBeDefined();
    expect(paymentDx?.evidence).toContain('2件');

    expect(digest.text).toContain('【社長AI管制塔｜問題集約レポート（過去30日）】');
    expect(digest.text).toContain('入金遅延・回収');
  });

  it('期間外・対象外ソースのメッセージは集計しない', async () => {
    // 2ヶ月前のLINE WORKSメッセージ（期間外）
    await analyzeAndSaveMessage(
      repo,
      lineworksMessage({
        externalMessageId: 'lw-old',
        receivedAt: '2026-05-01T00:00:00.000Z',
        text: 'C様から昨日の対応についてかなり怒っている様子。至急折り返し希望。'
      }),
      provider
    );
    // 期間内だがgmail（対象外ソース）
    await analyzeAndSaveMessage(
      repo,
      lineworksMessage({
        source: 'gmail',
        externalMessageId: 'gm-1',
        text: 'B現場で事故が発生しました。ケガ人の状況を確認中です。'
      }),
      provider
    );

    const digest = await generateProblemDigest(repo, { now: NOW });
    expect(digest.totalMessages).toBe(0);
    expect(digest.problemCount).toBe(0);
    expect(digest.text).toContain('なし');

    const allDigest = await generateProblemDigest(repo, { now: NOW, source: 'all' });
    expect(allDigest.totalMessages).toBe(1);
    expect(allDigest.problemCount).toBe(1);
  });

  it('同一ルームに問題が集中している場合はDX候補として提示する', async () => {
    const texts = [
      'B現場で追加外注が必要。今日決めないと明日の作業が止まります。',
      'また現場が止まりそうです。判断をお願いします。',
      '着工できない状態です。至急確認をお願いします。'
    ];
    for (const [index, text] of texts.entries()) {
      await analyzeAndSaveMessage(
        repo,
        lineworksMessage({
          externalMessageId: `lw-room-${index}`,
          roomName: '現場配置・緊急対応ルーム',
          text
        }),
        provider
      );
    }

    const digest = await generateProblemDigest(repo, { now: NOW });

    expect(digest.recurringSenders[0]).toEqual({ name: '現場配置・緊急対応ルーム', count: 3 });
    const concentration = digest.dxCandidates.find((c) => c.theme.includes('集中'));
    expect(concentration).toBeDefined();
    expect(concentration?.evidence).toContain('現場配置・緊急対応ルーム');
  });
});
