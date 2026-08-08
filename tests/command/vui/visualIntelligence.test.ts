import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CORE_VISUALS,
  PROVIDER_NAMES_HIDDEN_IN_MAIN_UI,
  ROLE_RING,
  coreSizeRatio,
  particleBudget
} from '../../../src/command/vui/visualSpec.js';
import { CommandEventBus, type AiCoreState } from '../../../src/command/events/eventBus.js';
import { CommandOrchestrator } from '../../../src/command/orchestrator/orchestrator.js';
import { InMemoryCommandRepository } from '../../../src/command/repositories/CommandRepository.js';
import { resetToolIdSeq } from '../../../src/command/tools/registry.js';
import { resetMemorySeq } from '../../../src/command/memory/store.js';
import { resetPlanSeq } from '../../../src/command/agents/rolePlanner.js';

const ASOF = '2026-08-08T00:00:00.000Z';
const ALL_STATES: AiCoreState[] = [
  'IDLE',
  'LISTENING',
  'THINKING',
  'SEARCHING',
  'ANALYZING',
  'RESEARCHING',
  'REMEMBERING',
  'CRITIQUING',
  'INNOVATING',
  'WAITING_APPROVAL',
  'RESPONDING',
  'WARNING',
  'ERROR',
  'OBSERVING',
  'LEARNING',
  'EXPERIMENTING',
  'EVALUATING'
];

const UI_HTML = readFileSync('docs/lcc-command-vui.html', 'utf8');

describe('VUI: AI CORE Visual Specification（§2-§3・§43）', () => {
  it('全13状態に視覚仕様があり、激しい点滅（>2Hz）がない', () => {
    for (const state of ALL_STATES) {
      const spec = CORE_VISUALS[state];
      expect(spec, state).toBeDefined();
      expect(spec.label.length, state).toBeGreaterThan(1);
      expect(spec.blinkHz, `${state} blinkHz`).toBeLessThanOrEqual(2);
      expect(spec.speed).toBeGreaterThan(0);
      expect(spec.speed).toBeLessThanOrEqual(1);
    }
    // 状態ごとの要求挙動（§3）
    expect(CORE_VISUALS.IDLE.motion).toBe('drift');
    expect(CORE_VISUALS.THINKING.motion).toBe('converge');
    expect(CORE_VISUALS.RESEARCHING.motion).toBe('stream');
    expect(CORE_VISUALS.REMEMBERING.motion).toBe('link');
    expect(CORE_VISUALS.INNOVATING.motion).toBe('reform');
    expect(CORE_VISUALS.WAITING_APPROVAL.motion).toBe('hold');
    expect(CORE_VISUALS.ERROR.motion).toBe('calm-error');
    expect(CORE_VISUALS.WARNING.blinkHz).toBeLessThanOrEqual(1); // 警戒でも点滅過多にしない
  });

  it('Role RingはRole名の日本語ラベルのみでProvider名を含まない（§4-§5）', () => {
    expect(ROLE_RING.length).toBeGreaterThanOrEqual(10);
    for (const entry of ROLE_RING) {
      expect(entry.label).toMatch(/^[一-龥゠-ヿ]{1,4}$/);
      for (const provider of PROVIDER_NAMES_HIDDEN_IN_MAIN_UI) {
        expect(entry.label).not.toContain(provider);
      }
    }
  });

  it('Particle予算: reduced-motionで0、低性能端末で自動削減（§29-§30）', () => {
    expect(particleBudget({ reducedMotion: true, mobile: false })).toBe(0);
    expect(particleBudget({ reducedMotion: false, mobile: true, hardwareConcurrency: 2 })).toBe(250);
    expect(particleBudget({ reducedMotion: false, mobile: true, hardwareConcurrency: 8 })).toBe(700);
    expect(
      particleBudget({ reducedMotion: false, mobile: false, hardwareConcurrency: 8, deviceMemoryGb: 8 })
    ).toBe(1600);
  });

  it('モバイルAI COREは25〜35%、スクロール時に縮小（§24）', () => {
    const mobile = coreSizeRatio(390, false);
    expect(mobile).toBeGreaterThanOrEqual(0.25);
    expect(mobile).toBeLessThanOrEqual(0.35);
    expect(coreSizeRatio(390, true)).toBeLessThan(mobile);
    expect(coreSizeRatio(1280, false)).toBeLessThanOrEqual(0.35);
  });
});

describe('VUI: UI実装ファイル（docs/lcc-command-vui.html）の完成条件検査', () => {
  it('全13状態のCORE挙動がUIへ実装されている（§43 Visual Tests）', () => {
    for (const state of ALL_STATES) expect(UI_HTML, state).toContain(`${state}:`);
  });

  it('Generative UI 17コンポーネント型のRendererがある（§11）', () => {
    const types = [
      'TEXT',
      'KPI',
      'CHART',
      'TABLE',
      'PROJECT_CARD',
      'CUSTOMER_CARD',
      'CASH_FLOW',
      'PIPELINE',
      'RANKING',
      'TIMELINE',
      'EVIDENCE',
      'MEMORY',
      'DECISION',
      'ALERT',
      'APPROVAL',
      'RESEARCH_RESULT',
      'COMPARISON'
    ];
    for (const type of types) expect(UI_HTML, type).toContain(`'${type}'`);
  });

  it('正直なUnknown State・Demo Isolation・音声準備中の表示がある（§25・§36-§37）', () => {
    expect(UI_HTML).toContain('音声機能は準備中');
    expect(UI_HTML).toContain('データ取得できません');
    expect(UI_HTML).toContain('未接続');
    expect(UI_HTML).toContain('銀行データ未接続');
    expect(UI_HTML).toContain('実績日報との案件紐付け準備中');
    expect(UI_HTML).toContain('デモ数値の表示は行いません');
  });

  it('Reduced Motion対応・Event Bus購読・Approval dry-run・根拠UIがある（§13・§22・§29）', () => {
    expect(UI_HTML).toContain('prefers-reduced-motion');
    expect(UI_HTML).toContain('/command/events');
    expect(UI_HTML).toContain('/command/chat');
    expect(UI_HTML).toContain('dry-run');
    expect(UI_HTML).toContain('根拠を見る');
    expect(UI_HTML).toContain('覚えて');
  });

  it('主画面へ内部Provider名を出さない（§5）', () => {
    for (const provider of ['Claude', 'GPT', 'Gemini', 'Anthropic', 'OpenAI', 'Manus']) {
      expect(UI_HTML, provider).not.toContain(provider);
    }
  });

  it('アクセシビリティ: aria-live・aria-label・キーボード操作（§31）', () => {
    expect(UI_HTML).toContain('aria-live');
    expect(UI_HTML).toContain('aria-label');
    expect(UI_HTML).toContain('keydown.enter');
    expect(UI_HTML).toContain('focus-visible');
  });
});

describe('VUI: 会話UXシーケンス（§44）とEvent Bus同期', () => {
  let repository: InMemoryCommandRepository;
  let orchestrator: CommandOrchestrator;
  let bus: CommandEventBus;

  beforeEach(() => {
    resetToolIdSeq();
    resetMemorySeq();
    resetPlanSeq();
    repository = new InMemoryCommandRepository();
    bus = new CommandEventBus();
    orchestrator = new CommandOrchestrator(repository, { eventBus: bus });
  });

  it('§44の連続会話でUI状態イベントが毎ターン流れ、各状態へ遷移する', async () => {
    const chat = (message: string) =>
      orchestrator.chat({ message, scope: 'lcc', asOf: ASOF, sessionId: 'vui44' });

    const sequence = [
      '今月どう？',
      'その中で一番危ないのは？',
      'なんで？',
      '根拠見せて',
      '本当に？',
      'じゃあどうする？',
      'もっと大胆に考えて',
      '低粗利案件は受注前に社長確認する、を覚えておいて'
    ];
    for (const message of sequence) {
      const before = bus.recent(500).length;
      const res = await chat(message);
      expect(res.text.length, message).toBeGreaterThan(0);
      const turnEvents = bus.recent(500).slice(before);
      expect(turnEvents.some((e) => e.event === 'AI_THINKING'), message).toBe(true);
      expect(turnEvents.some((e) => e.event === 'ANSWER_COMPLETED'), message).toBe(true);
    }
    const all = bus.recent(500);
    expect(all.some((e) => e.event === 'INNOVATION_STARTED')).toBe(true); // もっと大胆に
    expect(all.some((e) => e.event === 'MEMORY_UPDATED')).toBe(true); // 覚えておいて
    expect(bus.coreState().primaryState).toBe('IDLE'); // 会話終了後は待機
  });
});
