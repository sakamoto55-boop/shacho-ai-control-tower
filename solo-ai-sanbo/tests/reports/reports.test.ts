import { describe, expect, it } from 'vitest';
import { buildMorningBrief, type BriefInput } from '../../src/reports/morningBrief.js';
import { buildWeeklyReview } from '../../src/reports/weeklyReview.js';
import { makeDeal, makeMoney, makePillar, makeTime } from '../fixtures.js';

const NOW = new Date('2026-08-19T09:00:00.000Z');

function input(overrides: Partial<BriefInput> = {}): BriefInput {
  return { pillars: [makePillar()], deals: [], timeEntries: [], moneyEntries: [], ...overrides };
}

describe('buildMorningBrief', () => {
  it('期限切れ・当日・放置を分けて出す', () => {
    const brief = buildMorningBrief(
      input({
        deals: [
          makeDeal({ id: 'd1', title: '期限切れ案件', nextActionOn: '2026-08-17' }),
          makeDeal({ id: 'd2', title: '今日の案件', nextActionOn: '2026-08-19' }),
          makeDeal({ id: 'd3', title: '放置案件', nextActionOn: null, lastTouchedOn: '2026-08-10' })
        ]
      }),
      NOW
    );

    expect(brief.counts.overdue).toBe(1);
    expect(brief.counts.dueToday).toBe(1);
    expect(brief.counts.stalled).toBe(1);
    expect(brief.text).toContain('期限切れ案件');
    expect(brief.text).toContain('放置案件');
  });

  it('期限が来ている案件は放置として二重に数えない', () => {
    const brief = buildMorningBrief(
      input({
        deals: [makeDeal({ id: 'd1', nextActionOn: '2026-08-17', lastTouchedOn: '2026-08-01' })]
      }),
      NOW
    );

    expect(brief.counts.overdue).toBe(1);
    expect(brief.counts.stalled).toBe(0);
  });

  it('未入金は受け取った分を差し引いて出す', () => {
    const brief = buildMorningBrief(
      input({
        deals: [makeDeal({ id: 'd1', stage: 'invoiced', amountYen: 500_000, nextActionOn: null })],
        moneyEntries: [makeMoney({ dealId: 'd1', amountYen: 200_000 })]
      }),
      NOW
    );

    expect(brief.counts.unpaid).toBe(1);
    expect(brief.text).toContain('残り30万円');
  });

  it('入金済みなのに請求済みのままの案件を知らせる', () => {
    const brief = buildMorningBrief(
      input({
        deals: [makeDeal({ id: 'd1', stage: 'invoiced', amountYen: 500_000, nextActionOn: null })],
        moneyEntries: [makeMoney({ dealId: 'd1', amountYen: 500_000 })]
      }),
      NOW
    );

    expect(brief.counts.unpaid).toBe(0);
    expect(brief.text).toContain('請求済みのまま');
  });

  it('見直し日が来た柱を出す', () => {
    const brief = buildMorningBrief(
      input({ pillars: [makePillar({ reviewOn: '2026-08-19', targetMonthlyProfitYen: 300_000 })] }),
      NOW
    );

    expect(brief.counts.reviewDuePillars).toBe(1);
    expect(brief.text).toContain('見直し日が来た柱');
  });

  it('何もなければその旨を返す', () => {
    const brief = buildMorningBrief(input(), NOW);

    expect(brief.text).toContain('期限も放置案件もありません');
  });

  it('参謀として結論は書かず、選択肢を出す', () => {
    const brief = buildMorningBrief(
      input({ deals: [makeDeal({ id: 'd1', nextActionOn: '2026-08-17' })] }),
      NOW
    );

    expect(brief.text).toContain('決めるのはあなたです');
    expect(brief.items.every((item) => item.options.length > 0)).toBe(true);
  });
});

describe('buildWeeklyReview', () => {
  const pillars = [
    makePillar({ id: 'p-high', name: '解体' }),
    makePillar({ id: 'p-low', name: '発信', kind: 'content' })
  ];

  it('柱を時給の高い順に並べる', () => {
    const review = buildWeeklyReview(
      {
        pillars,
        deals: [],
        timeEntries: [
          makeTime({ id: 't1', pillarId: 'p-high', minutes: 60 }),
          makeTime({ id: 't2', pillarId: 'p-low', minutes: 600 })
        ],
        moneyEntries: [
          makeMoney({ id: 'm1', pillarId: 'p-high', amountYen: 100_000 }),
          makeMoney({ id: 'm2', pillarId: 'p-low', amountYen: 10_000 })
        ]
      },
      NOW
    );

    expect(review.summaries.map((item) => item.pillar.name)).toEqual(['解体', '発信']);
    expect(review.text).toContain('一番高い: 解体');
  });

  it('時間を使ったのに粗利が出ていない柱を指摘する', () => {
    const review = buildWeeklyReview(
      {
        pillars: [makePillar({ id: 'p-low', name: '発信' })],
        deals: [],
        timeEntries: [makeTime({ pillarId: 'p-low', minutes: 600 })],
        moneyEntries: []
      },
      NOW
    );

    expect(review.text).toContain('粗利が出ていない柱');
  });

  it('期間外の記録を混ぜない', () => {
    const review = buildWeeklyReview(
      {
        pillars: [makePillar()],
        deals: [],
        timeEntries: [makeTime({ date: '2026-07-01', minutes: 6000 })],
        moneyEntries: [makeMoney({ date: '2026-07-01', amountYen: 900_000 })]
      },
      NOW,
      7
    );

    expect(review.summaries[0].hours).toBe(0);
    expect(review.summaries[0].profitYen).toBe(0);
  });

  it('記録が足りなければ、まず記録するよう促す', () => {
    const review = buildWeeklyReview(
      { pillars: [makePillar()], deals: [], timeEntries: [], moneyEntries: [] },
      NOW
    );

    expect(review.text).toContain('判断できるだけの記録がありません');
  });

  it('撤退済みの柱は集計に混ぜない', () => {
    const review = buildWeeklyReview(
      {
        pillars: [makePillar({ id: 'p-dropped', status: 'dropped' })],
        deals: [],
        timeEntries: [makeTime({ pillarId: 'p-dropped', minutes: 120 })],
        moneyEntries: []
      },
      NOW
    );

    expect(review.summaries).toHaveLength(0);
  });
});
