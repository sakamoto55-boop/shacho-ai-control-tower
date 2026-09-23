import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

// Execute the shipped UI's real loaders without mounting a browser or using company data.
const html = readFileSync('docs/lcc-command-vui.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
type Ui = Record<string, any>;
type UiFunction = (this: Ui, ...args: unknown[]) => unknown;
function createUi(fetcher: ReturnType<typeof vi.fn>) {
  let component: Ui = {};
  runInNewContext(script, {
    Vue: {
      createApp: (options: Ui) => { component = options; return { mount() {} }; },
      defineComponent: (options: Ui) => options,
      h: vi.fn(),
    },
    fetch: fetcher, URL, URLSearchParams,
    location: { search: '', href: 'http://localhost/' },
    localStorage: { getItem: () => null },
    window: { matchMedia: () => ({ matches: false }) },
  });
  const ui: Ui = component.data();
  for (const [key, fn] of Object.entries(component.methods)) ui[key] = (fn as UiFunction).bind(ui);
  for (const [key, fn] of Object.entries(component.computed)) Object.defineProperty(ui, key, { get: (fn as UiFunction).bind(ui) });
  return ui;
}
const response = (status: number, body: unknown = {}) => ({ ok: status < 400, status, json: async () => body });

describe('executive UI data availability', () => {
  it('keeps unverified counts unknown until a successful response and shows source limitations', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(200, { items: [], decisions: [], tracking: { trackingCount: 0, completedTodayCount: null }, limitations: ['外部タスクの追跡は未接続です'] }));
    const ui = createUi(fetcher);
    expect(ui.tracking.trackingCount).toBeNull();
    expect(ui.statusLine).toBe('データ接続を確認中');
    await ui.loadDecisions();
    expect(ui.decisions.loaded).toBe(true);
    expect(ui.decisions.notes).toEqual(['外部タスクの追跡は未接続です']);
    expect(ui.tracking.trackingCount).toBe(0);
    expect(ui.tracking.completedTodayCount).toBeNull();
    expect(ui.tracking.awaitingReplyCount).toBeNull();
    fetcher.mockResolvedValue(response(503));
    await ui.loadDecisions();
    expect(ui.decisions.loaded).toBe(false);
    expect(ui.tracking.trackingCount).toBeNull();
  });

  it('does not turn malformed decisions or counts into confirmed zero', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(200, {}));
    const ui = createUi(fetcher);
    await ui.loadDecisions();
    expect(ui.decisions.loaded).toBe(false);
    fetcher.mockResolvedValue(response(200, { items: [], decisions: [], tracking: { trackingCount: -1, completedTodayCount: '0' } }));
    await ui.loadDecisions();
    expect(ui.tracking.trackingCount).toBeNull();
    expect(ui.tracking.completedTodayCount).toBeNull();
  });

  it.each(['loadMoney', 'loadSite', 'loadPeople'])('%s reports total failure instead of a loaded empty dashboard', async (method) => {
    const ui = createUi(vi.fn().mockResolvedValue(response(503)));
    await ui[method]();
    const state = ui[method.slice(4).toLowerCase()];
    expect(state.loaded).toBe(false);
    expect(state.error).toBeTruthy();
  });

  it('retains verified data but explains partial failures', async () => {
    const ui = createUi(vi.fn(async (url: string) => url.endsWith('/kpi')
      ? response(200, { kpis: [{ label: 'テスト指標', value: 123 }] }) : response(503)));
    await ui.loadMoney();
    expect(ui.money.loaded).toBe(true);
    expect(ui.money.kpis[0].value).toBe(123);
    expect(ui.money.error).toContain('5/6');
    expect(ui.money.keiri).toBeNull();
  });

  it.each(['loadMoney', 'loadSite', 'loadPeople', 'loadDecisions', 'loadTracking'])('%s preserves authentication failure', async (method) => {
    const ui = createUi(vi.fn().mockResolvedValue(response(401)));
    await ui[method]('active');
    expect(ui.authRequired).toBe(true);
    const state = ui[method.slice(4).toLowerCase()];
    expect(method === 'loadTracking' ? ui.trackingLoaded : state.loaded).toBe(false);
    expect(method === 'loadTracking' ? ui.trackingError : (state.error || state.reason)).toContain('認証が必要');
  });

  it('distinguishes unavailable tracking from a confirmed empty result', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(503));
    const ui = createUi(fetcher);
    await ui.loadTracking('active');
    expect(ui.trackingLoaded).toBe(false);
    expect(ui.trackingError).toBeTruthy();
    fetcher.mockResolvedValue(response(200, { actions: [] }));
    await ui.loadTracking('completed');
    expect(ui.trackingLoaded).toBe(true);
    expect(ui.trackingError).toBe('');
  });

  it('ignores older tracking responses after switching views', async () => {
    let resolveFirst!: (value: unknown) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(response(200, { actions: [{ actionId: 'done' }] }));
    const ui = createUi(fetcher);
    const first = ui.loadTracking('active');
    await ui.loadTracking('completed');
    resolveFirst(response(200, { actions: [{ actionId: 'old' }] }));
    await first;
    expect(ui.trackingView).toBe('completed');
    expect(ui.trackingItems[0].actionId).toBe('done');
  });

  it.each([503, 200])('clears a previous cash balance when it is no longer available (HTTP %s)', async (status) => {
    const ui = createUi(vi.fn().mockResolvedValue(response(status, { available: false })));
    ui.homeCash = { currentBalance: 123 };
    await ui.loadHomeCash();
    expect(ui.homeCash).toBeNull();
  });

  it('does not call an empty source list connected', async () => {
    const ui = createUi(vi.fn().mockResolvedValue(response(200, { connections: [] })));
    await ui.loadHealth();
    expect(ui.statusLine).toBe('実データの接続を確認できません');
  });
});
