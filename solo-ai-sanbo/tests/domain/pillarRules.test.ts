import { describe, expect, it } from 'vitest';
import {
  isBleeding,
  isReviewDue,
  judgeAgainstTarget,
  rankByHourly,
  summarizePillar
} from '../../src/domain/pillarRules.js';
import { makeDeal, makeMoney, makePillar, makeTime } from '../fixtures.js';

describe('summarizePillar', () => {
  it('時間とお金から時給を出す', () => {
    const pillar = makePillar();
    const summary = summarizePillar(
      pillar,
      [],
      [makeTime({ minutes: 120 })],
      [makeMoney({ amountYen: 60_000 }), makeMoney({ id: 'm2', kind: 'expense', amountYen: 20_000 })]
    );

    expect(summary.hours).toBe(2);
    expect(summary.profitYen).toBe(40_000);
    expect(summary.profitPerHourYen).toBe(20_000);
  });

  it('時間の記録がない柱は時給をnullにする（0円と読ませない）', () => {
    const summary = summarizePillar(makePillar(), [], [], [makeMoney({ amountYen: 50_000 })]);

    expect(summary.profitPerHourYen).toBeNull();
    expect(summary.profitYen).toBe(50_000);
  });

  it('期間を指定すると範囲外の記録を除く', () => {
    const summary = summarizePillar(
      makePillar(),
      [],
      [makeTime({ date: '2026-08-01', minutes: 600 }), makeTime({ id: 't2', date: '2026-08-19', minutes: 60 })],
      [],
      { from: '2026-08-13', to: '2026-08-19' }
    );

    expect(summary.hours).toBe(1);
  });

  it('進行中案件の期待値と未入金を分けて数える', () => {
    const summary = summarizePillar(
      makePillar(),
      [
        makeDeal({ id: 'd1', stage: 'quoted', amountYen: 1_000_000, costYen: 400_000 }),
        makeDeal({ id: 'd2', stage: 'invoiced', amountYen: 300_000, costYen: 0 }),
        makeDeal({ id: 'd3', stage: 'lost', amountYen: 900_000, costYen: 0 })
      ],
      [],
      []
    );

    // quoted は確度0.5 → 60万×0.5、invoiced は確度1 → 30万
    expect(summary.pipelineYen).toBe(600_000);
    expect(summary.openDealCount).toBe(2);
    expect(summary.unpaidYen).toBe(300_000);
  });

  it('入金を記録済みの請求案件は未入金に数えない', () => {
    const summary = summarizePillar(
      makePillar(),
      [makeDeal({ id: 'd1', stage: 'invoiced', amountYen: 300_000, costYen: 0 })],
      [],
      [makeMoney({ dealId: 'd1', amountYen: 300_000 })]
    );

    expect(summary.unpaidYen).toBe(0);
  });
});

describe('rankByHourly', () => {
  it('時給の高い順に並べ、算出できない柱を後ろへ置く', () => {
    const low = summarizePillar(
      makePillar({ id: 'p-low', name: '低' }),
      [],
      [makeTime({ pillarId: 'p-low', minutes: 600 })],
      [makeMoney({ pillarId: 'p-low', amountYen: 10_000 })]
    );
    const high = summarizePillar(
      makePillar({ id: 'p-high', name: '高' }),
      [],
      [makeTime({ pillarId: 'p-high', minutes: 60 })],
      [makeMoney({ pillarId: 'p-high', amountYen: 50_000 })]
    );
    const unknown = summarizePillar(makePillar({ id: 'p-none', name: '未計測' }), [], [], []);

    expect(rankByHourly([low, unknown, high]).map((item) => item.pillar.name)).toEqual([
      '高',
      '低',
      '未計測'
    ]);
  });
});

describe('isReviewDue', () => {
  it('見直し日が来ていれば知らせる', () => {
    expect(isReviewDue(makePillar({ reviewOn: '2026-08-19' }), '2026-08-19')).toBe(true);
    expect(isReviewDue(makePillar({ reviewOn: '2026-08-20' }), '2026-08-19')).toBe(false);
  });

  it('見直し日がない柱と撤退済みの柱は対象外', () => {
    expect(isReviewDue(makePillar({ reviewOn: null }), '2026-08-19')).toBe(false);
    expect(isReviewDue(makePillar({ reviewOn: '2026-01-01', status: 'dropped' }), '2026-08-19')).toBe(false);
  });
});

describe('judgeAgainstTarget と isBleeding', () => {
  it('基準の達成可否を返す', () => {
    const met = summarizePillar(
      makePillar({ targetMonthlyProfitYen: 100_000 }),
      [],
      [makeTime()],
      [makeMoney({ amountYen: 200_000 })]
    );
    const missed = summarizePillar(
      makePillar({ targetMonthlyProfitYen: 300_000 }),
      [],
      [makeTime()],
      [makeMoney({ amountYen: 200_000 })]
    );
    const unknown = summarizePillar(makePillar(), [], [makeTime()], []);

    expect(judgeAgainstTarget(met)).toBe('met');
    expect(judgeAgainstTarget(missed)).toBe('missed');
    expect(judgeAgainstTarget(unknown)).toBe('unknown');
  });

  it('時間を使ったのに粗利が出ていない柱を見つける', () => {
    const bleeding = summarizePillar(makePillar(), [], [makeTime({ minutes: 600 })], []);
    const short = summarizePillar(makePillar(), [], [makeTime({ minutes: 60 })], []);

    expect(isBleeding(bleeding)).toBe(true);
    // 数時間では判断材料にならないので騒がない
    expect(isBleeding(short)).toBe(false);
  });
});
