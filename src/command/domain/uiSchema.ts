/**
 * Generative UI Schema（Phase B1.5 §23-§25）。
 *
 * AIがHTMLを自由生成するのではなく、安全なUI Component Schemaを返す。
 * Phase VUIはこのSchemaを解釈して表示コンポーネントを切り替える。
 * componentsのdataには機微情報の実値（給与・口座等）を含めない。
 */
import type { CommandChatResponse, Evidence } from './types.js';

export type UiComponentType =
  | 'TEXT'
  | 'KPI'
  | 'CHART'
  | 'TABLE'
  | 'PROJECT_CARD'
  | 'CUSTOMER_CARD'
  | 'CASH_FLOW'
  | 'PIPELINE'
  | 'RANKING'
  | 'TIMELINE'
  | 'EVIDENCE'
  | 'MEMORY'
  | 'DECISION'
  | 'ALERT'
  | 'APPROVAL'
  | 'RESEARCH_RESULT'
  | 'COMPARISON';

export interface UiComponent {
  type: UiComponentType;
  /** コンポーネント固有データ（構造化済み。自由HTMLは不可） */
  data?: unknown;
  title?: string;
}

export interface SuggestedAction {
  label: string;
  /** 実行時にそのままchatへ送るメッセージ */
  message: string;
}

/** UI Response Schema（§24） */
export interface UiChatResponse {
  message: string;
  components: UiComponent[];
  evidence: Evidence[];
  confidence: CommandChatResponse['confidence'];
  freshness?: string;
  suggestedActions: SuggestedAction[];
}

const UI_HINT_TO_COMPONENT: Record<string, UiComponentType> = {
  brief: 'KPI',
  kpi: 'KPI',
  cash: 'CASH_FLOW',
  cash_forecast: 'CASH_FLOW',
  ranking: 'RANKING',
  project: 'PROJECT_CARD',
  project_card: 'PROJECT_CARD',
  customer: 'CUSTOMER_CARD',
  pipeline: 'PIPELINE',
  alerts: 'ALERT',
  approval: 'APPROVAL',
  research: 'RESEARCH_RESULT',
  memory: 'MEMORY',
  text: 'TEXT'
};

/** 意図・内容に応じたSuggested Actions（§25。固定ボタンだけにしない） */
export function buildSuggestedActions(response: CommandChatResponse): SuggestedAction[] {
  const actions: SuggestedAction[] = [];
  if (response.evidence.length > 0) actions.push({ label: '根拠を見る', message: '根拠見せて' });
  if (/【AIの(提案|推測|分析)】|【推奨】/.test(response.text)) {
    actions.push({ label: '反対意見を見る', message: '別の見方は？' });
    actions.push({ label: '改善案', message: 'もっと良いやり方ない？' });
  }
  if (/案件|工事/.test(response.text)) {
    actions.push({ label: '過去の類似事例', message: '前に似たことなかった？' });
  }
  if (/危な|リスク|低下|超過/.test(response.text)) {
    actions.push({ label: '詳しく分析', message: 'なんで？' });
  }
  actions.push({ label: '覚えて', message: '今のを覚えておいて' });
  actions.push({ label: '訂正する', message: 'それ違う。今は' });
  return actions.slice(0, 6);
}

/** CommandChatResponse → UI Response Schema（§24）。既存応答を壊さない付加変換 */
export function buildUiResponse(response: CommandChatResponse): UiChatResponse {
  const componentType = UI_HINT_TO_COMPONENT[response.uiHint ?? 'text'] ?? 'TEXT';
  const components: UiComponent[] = [{ type: componentType, data: response.data }];
  if (response.evidence.length > 0) {
    components.push({ type: 'EVIDENCE', data: response.evidence, title: '根拠' });
  }
  if (response.approvalRequest) {
    components.push({ type: 'APPROVAL', data: response.approvalRequest, title: '承認待ち' });
  }
  return {
    message: response.text,
    components,
    evidence: response.evidence,
    confidence: response.confidence,
    suggestedActions: buildSuggestedActions(response)
  };
}
