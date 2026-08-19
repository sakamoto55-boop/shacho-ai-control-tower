import type { Deal, MoneyEntry, Pillar, TimeEntry } from '../src/domain/types.js';

const NOW = '2026-08-19T00:00:00.000Z';

export function makePillar(overrides: Partial<Pillar> = {}): Pillar {
  return {
    id: 'pillar-service',
    name: '解体の個人受注',
    kind: 'service',
    status: 'testing',
    startedOn: '2026-08-01',
    reviewOn: null,
    targetMonthlyProfitYen: null,
    note: '',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

export function makeDeal(overrides: Partial<Deal> = {}): Deal {
  return {
    id: 'deal-1',
    pillarId: 'pillar-service',
    title: '空き家解体',
    clientName: '田中様',
    contact: '',
    stage: 'inquiry',
    amountYen: 1_500_000,
    costYen: 600_000,
    nextAction: '現地見積',
    nextActionOn: null,
    lastTouchedOn: '2026-08-19',
    memo: '',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

export function makeTime(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: 'time-1',
    pillarId: 'pillar-service',
    dealId: null,
    date: '2026-08-19',
    minutes: 60,
    category: 'delivery',
    note: '',
    createdAt: NOW,
    ...overrides
  };
}

export function makeMoney(overrides: Partial<MoneyEntry> = {}): MoneyEntry {
  return {
    id: 'money-1',
    pillarId: 'pillar-service',
    dealId: null,
    date: '2026-08-19',
    kind: 'income',
    amountYen: 100_000,
    label: '',
    createdAt: NOW,
    ...overrides
  };
}
