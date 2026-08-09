/**
 * Phase VUI — AI CORE Visual Specification（正本）。
 *
 * AI CORE（粒子知能体）の状態別視覚挙動・パフォーマンス予算・Role配置の
 * canonical仕様。docs/lcc-command-vui.html はこの仕様と同じ値で描画する
 * （単一HTML完結アプリのため実行時importはしないが、テストはここを検証し、
 * UI側との乖離は tests/command/vui/ が文字列レベルで検査する）。
 *
 * 制約（§3・§29-§31）:
 * - 激しい点滅禁止（blinkHz は 0 または 2Hz 以下）
 * - prefers-reduced-motion では静的表示でも情報が失われない（stateLabelで代替）
 * - 低性能端末ではParticle数を自動削減する
 */
import type { AiCoreState } from '../events/eventBus.js';

export type CoreMotion =
  | 'drift' // ゆっくり漂う
  | 'listen' // 入力へ反応
  | 'converge' // 中心へ収束
  | 'radiate' // 外側へ探索
  | 'orbit' // 複数レイヤー同期回転
  | 'stream' // 外部へ伸びる粒子流
  | 'link' // Memory領域との光接続
  | 'tighten' // 収束・検証
  | 'reform' // 一度崩れて再構成
  | 'hold' // 静止に近い待機
  | 'pulse' // 出力に同期した脈動
  | 'alert' // 警戒（点滅ではなく色と張り）
  | 'calm-error'; // 落ち着いた異常表示

export interface CoreVisualSpec {
  /** 状態の日本語ラベル（aria-live・スクリーンリーダー用） */
  label: string;
  motion: CoreMotion;
  /** アニメーション速度 0-1（1でも「常時高速」にしない） */
  speed: number;
  /** 粒子の収束度 -1（拡散）〜 1（収束） */
  convergence: number;
  /** 明滅周波数Hz。0=明滅なし。2Hz超は禁止（§3） */
  blinkHz: number;
  /** デザイントークン名（実色はCSS変数側で定義） */
  tintToken: string;
}

export const CORE_VISUALS: Record<AiCoreState, CoreVisualSpec> = {
  IDLE: { label: '待機中', motion: 'drift', speed: 0.15, convergence: 0, blinkHz: 0, tintToken: 'core-idle' },
  LISTENING: { label: 'お聞きしています', motion: 'listen', speed: 0.35, convergence: 0.2, blinkHz: 0, tintToken: 'core-listen' },
  THINKING: { label: '考えています', motion: 'converge', speed: 0.5, convergence: 0.7, blinkHz: 0, tintToken: 'core-think' },
  SEARCHING: { label: '社内データを検索中', motion: 'radiate', speed: 0.55, convergence: -0.4, blinkHz: 0, tintToken: 'core-search' },
  ANALYZING: { label: '分析中', motion: 'orbit', speed: 0.5, convergence: 0.3, blinkHz: 0, tintToken: 'core-analyze' },
  RESEARCHING: { label: '外部情報を調査中', motion: 'stream', speed: 0.6, convergence: -0.6, blinkHz: 0, tintToken: 'core-research' },
  REMEMBERING: { label: '記憶を参照中', motion: 'link', speed: 0.4, convergence: 0.4, blinkHz: 0, tintToken: 'core-memory' },
  CRITIQUING: { label: '検証中', motion: 'tighten', speed: 0.45, convergence: 0.8, blinkHz: 0, tintToken: 'core-critic' },
  INNOVATING: { label: '新しい案を構想中', motion: 'reform', speed: 0.65, convergence: -0.2, blinkHz: 0, tintToken: 'core-innovate' },
  WAITING_APPROVAL: { label: 'ご承認をお待ちしています', motion: 'hold', speed: 0.08, convergence: 0.5, blinkHz: 0, tintToken: 'core-approval' },
  RESPONDING: { label: '回答しています', motion: 'pulse', speed: 0.5, convergence: 0.5, blinkHz: 1, tintToken: 'core-respond' },
  WARNING: { label: '注意が必要です', motion: 'alert', speed: 0.4, convergence: 0.6, blinkHz: 0.5, tintToken: 'core-warning' },
  ERROR: { label: '接続に問題があります', motion: 'calm-error', speed: 0.1, convergence: 0.1, blinkHz: 0, tintToken: 'core-error' },
  // Phase GROWTH（§38）。観測・学習系は落ち着いた挙動（常時派手に動かさない）
  OBSERVING: { label: '会社を観測しています', motion: 'drift', speed: 0.2, convergence: 0.1, blinkHz: 0, tintToken: 'core-idle' },
  LEARNING: { label: '学習しています', motion: 'link', speed: 0.3, convergence: 0.4, blinkHz: 0, tintToken: 'core-memory' },
  EXPERIMENTING: { label: '実験を追跡しています', motion: 'orbit', speed: 0.3, convergence: 0.2, blinkHz: 0, tintToken: 'core-analyze' },
  EVALUATING: { label: '結果を評価しています', motion: 'tighten', speed: 0.3, convergence: 0.6, blinkHz: 0, tintToken: 'core-critic' }
};

/** AI CORE周辺に配置するRole Ring（§4）。内部Provider名は含めない */
export const ROLE_RING: Array<{ role: string; label: string }> = [
  { role: 'STRATEGY', label: '戦略' },
  { role: 'FINANCE', label: '資金' },
  { role: 'SALES', label: '営業' },
  { role: 'OPERATIONS', label: '現場' },
  { role: 'ANALYSIS', label: '分析' },
  { role: 'RESEARCH', label: '調査' },
  { role: 'MEMORY', label: '記憶' },
  { role: 'CRITIC', label: '検証' },
  { role: 'INNOVATION', label: '創発' },
  { role: 'SYNTHESIS', label: '統合' }
];

/**
 * Particle数のパフォーマンス予算（§28・§30）。
 * reduced-motion時は0（静的グラデーション表示に切替。状態はラベルで伝える＝情報を失わない）。
 */
export function particleBudget(options: {
  reducedMotion: boolean;
  mobile: boolean;
  hardwareConcurrency?: number;
  deviceMemoryGb?: number;
}): number {
  if (options.reducedMotion) return 0;
  const cores = options.hardwareConcurrency ?? 4;
  const memory = options.deviceMemoryGb ?? 4;
  const lowEnd = cores <= 2 || memory <= 2;
  if (options.mobile) return lowEnd ? 250 : 700;
  return lowEnd ? 600 : 1600;
}

/** モバイルでのAI CORE高さ比率（§24: 25〜35%、スクロール時は縮小） */
export function coreSizeRatio(viewportWidth: number, scrolled: boolean): number {
  if (viewportWidth >= 1024) return scrolled ? 0.22 : 0.3;
  return scrolled ? 0.16 : 0.3;
}

/** 主画面へ出してはならない内部Provider名（§5。詳細表示のみ許可） */
export const PROVIDER_NAMES_HIDDEN_IN_MAIN_UI = ['Claude', 'GPT', 'Gemini', 'Manus', 'Anthropic', 'OpenAI'];
