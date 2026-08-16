import { describe, expect, it } from 'vitest';
import { buildSnsPostPlan, checkAdCompliance } from '../../src/domain/snsContentRules.js';

describe('buildSnsPostPlan', () => {
  it('指定日数×チャンネル数のコマを作る', () => {
    const plan = buildSnsPostPlan({ fromDate: '2026-08-17', days: 7, channels: ['instagram'] });
    expect(plan).toHaveLength(7);
    expect(plan[0].scheduledDate).toBe('2026-08-17');
    expect(plan[6].scheduledDate).toBe('2026-08-23');
  });

  it('曜日ごとにテーマを割り当てる', () => {
    // 2026-08-17は月曜日
    const plan = buildSnsPostPlan({ fromDate: '2026-08-17', days: 2, channels: ['instagram'] });
    expect(plan[0].purpose).toBe('case_study');
    expect(plan[1].purpose).toBe('trust_building');
  });

  it('同じ事業が連日続かないようローテーションする', () => {
    const plan = buildSnsPostPlan({ fromDate: '2026-08-17', days: 3, channels: ['instagram'] });
    expect(new Set(plan.map((slot) => slot.businessLine)).size).toBe(3);
  });

  it('日数の上限を60日に丸める', () => {
    const plan = buildSnsPostPlan({ fromDate: '2026-08-17', days: 400, channels: ['x'] });
    expect(plan).toHaveLength(60);
  });
});

describe('checkAdCompliance', () => {
  it('断定表現と最上級表現を検出する', () => {
    const reasons = checkAdCompliance('必ず地域No.1の仕上がりになります');
    expect(reasons.length).toBeGreaterThanOrEqual(2);
  });

  it('価格の言い切りを検出する', () => {
    const reasons = checkAdCompliance('解体は30万円で対応します');
    expect(reasons.join('')).toContain('価格の言い切り');
  });

  it('問題のない文面では指摘を返さない', () => {
    const reasons = checkAdCompliance('現地を確認したうえで、作業範囲と工程をご説明します。');
    expect(reasons).toHaveLength(0);
  });
});
