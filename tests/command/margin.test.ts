import { describe, expect, it } from 'vitest';
import { buildSeedDataset } from '../../src/command/data/seed.js';
import {
  computeProjectMargin,
  findMarginDeteriorations,
  computeOverallForecastMarginRate
} from '../../src/command/engines/margin.js';

const ASOF = '2026-08-08T00:00:00.000Z';

describe('粗利エンジン', () => {
  it('A案件の予測粗利が35%→24.8%へ低下し、主因を特定できる', () => {
    const dataset = buildSeedDataset(ASOF);
    const project = dataset.projects.find((item) => item.projectId === 'prj-a')!;
    const margin = computeProjectMargin(dataset, project);

    expect(margin.plannedMarginRate).toBe(0.35);
    expect(margin.forecastMarginRate).toBeCloseTo(0.248, 3);
    expect(margin.varianceDrivers[0]).toMatchObject({ category: 'subcontract', diff: 800_000 });
    expect(margin.varianceDrivers[1]).toMatchObject({ category: 'disposal', diff: 424_000 });
  });

  it('完工済み案件は実績粗利を確定させる', () => {
    const dataset = buildSeedDataset(ASOF);
    const project = dataset.projects.find((item) => item.projectId === 'prj-b')!;
    const margin = computeProjectMargin(dataset, project);
    expect(margin.actualMarginRate).toBeCloseTo(0.3, 5);
  });

  it('原価未登録の案件は粗利をnull（不明）とし推測で埋めない', () => {
    const dataset = buildSeedDataset(ASOF);
    const project = dataset.projects.find((item) => item.projectId === 'prj-d')!;
    const margin = computeProjectMargin(dataset, project);
    expect(margin.forecastMarginRate).toBeNull();
    expect(margin.actualMarginRate).toBeNull();
  });

  it('粗利悪化案件の検出はA案件のみ', () => {
    const dataset = buildSeedDataset(ASOF);
    const deteriorations = findMarginDeteriorations(dataset, 'group');
    expect(deteriorations).toHaveLength(1);
    expect(deteriorations[0].margin.projectId).toBe('prj-a');
    expect(deteriorations[0].drop).toBeCloseTo(0.102, 3);
  });

  it('全社予測粗利率は受注額加重平均で計算する', () => {
    const dataset = buildSeedDataset(ASOF);
    const rate = computeOverallForecastMarginRate(dataset, 'lcc');
    expect(rate).toBeCloseTo(0.2731, 3);
  });

  it('根拠に計算式とデータソースを含める', () => {
    const dataset = buildSeedDataset(ASOF);
    const project = dataset.projects.find((item) => item.projectId === 'prj-a')!;
    const margin = computeProjectMargin(dataset, project);
    expect(margin.evidence.some((evidence) => evidence.label === '計算式')).toBe(true);
    expect(margin.evidence.some((evidence) => evidence.source === '原価管理')).toBe(true);
  });
});
