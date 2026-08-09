/**
 * Multi-Agent Role定義（Phase N）。
 *
 * 最重要原則: モデル名を業務Roleとして扱わない。
 *   Role → Required Capability → Provider / Model / Tool
 * の3層とし、ChatGPT/Claude/Gemini/Manus等は交換可能な実装Providerである。
 * Roleは「人格」ではなく責務。共有チャットで自由に議論させず、構造化Task結果を返す。
 */
import type { ActionRiskLevel } from '../domain/types.js';

export type RoleId =
  | 'STRATEGY'
  | 'ANALYSIS'
  | 'FINANCE'
  | 'SALES'
  | 'OPERATIONS'
  | 'STRUCTURING'
  | 'RESEARCH'
  | 'WRITING'
  | 'INNOVATION'
  | 'EXECUTION'
  | 'MEMORY'
  | 'CRITIC'
  | 'SYNTHESIS';

export type Capability =
  | 'reasoning'
  | 'deterministic_calc'
  | 'web_research'
  | 'long_running'
  | 'structured_output'
  | 'tool_calling'
  | 'writing'
  | 'memory_access';

export interface RoleDefinition {
  roleId: RoleId;
  description: string;
  requiredCapabilities: Capability[];
  allowedTools: string[];
  riskLevel: ActionRiskLevel;
  /** 回答に根拠を必須とするか */
  requiredEvidence: boolean;
  maxSteps: number;
  maxToolCalls: number;
  timeoutMs: number;
  preferredProviders: string[];
  fallbackProviders: string[];
  /** このRoleへ渡してよいMemory層（Privacy Boundary: 最小情報のみ渡す） */
  memoryAccess: Array<'COMPANY' | 'PRESIDENT' | 'OPERATIONAL' | 'EXTERNAL'>;
  /** 機微データ（給与等）を扱う可能性があるRoleか */
  handlesSensitive: boolean;
}

const base = {
  maxSteps: 4,
  maxToolCalls: 6,
  timeoutMs: 8000,
  preferredProviders: ['anthropic'],
  fallbackProviders: ['deterministic'],
  handlesSensitive: false
};

export const ROLES: Record<RoleId, RoleDefinition> = {
  STRATEGY: {
    ...base,
    roleId: 'STRATEGY',
    description: '経営戦略の選択肢整理と評価（決定はしない）',
    requiredCapabilities: ['reasoning', 'memory_access'],
    allowedTools: ['get_company_summary', 'get_sales_summary', 'memory_search'],
    riskLevel: 1,
    requiredEvidence: true,
    memoryAccess: ['COMPANY', 'PRESIDENT', 'OPERATIONAL']
  },
  ANALYSIS: {
    ...base,
    roleId: 'ANALYSIS',
    description: '社内データの決定論的分析（数値計算はエンジンに委譲）',
    requiredCapabilities: ['deterministic_calc', 'tool_calling'],
    allowedTools: ['get_sales_summary', 'get_project_margin', 'get_invoice_status', 'get_alerts'],
    riskLevel: 1,
    requiredEvidence: true,
    preferredProviders: ['deterministic'],
    memoryAccess: ['COMPANY', 'OPERATIONAL']
  },
  FINANCE: {
    ...base,
    roleId: 'FINANCE',
    description: '資金繰り・収益モデルの決定論的評価',
    requiredCapabilities: ['deterministic_calc'],
    allowedTools: ['get_cash_position', 'get_cash_forecast', 'get_sales_summary'],
    riskLevel: 1,
    requiredEvidence: true,
    preferredProviders: ['deterministic'],
    memoryAccess: ['COMPANY', 'PRESIDENT'],
    handlesSensitive: true
  },
  SALES: {
    ...base,
    roleId: 'SALES',
    description: '営業パイプライン・追客状況の把握',
    requiredCapabilities: ['deterministic_calc'],
    allowedTools: ['get_pipeline', 'get_sales_leaks', 'get_interactions'],
    riskLevel: 1,
    requiredEvidence: true,
    preferredProviders: ['deterministic'],
    memoryAccess: ['COMPANY', 'OPERATIONAL']
  },
  OPERATIONS: {
    ...base,
    roleId: 'OPERATIONS',
    description: '配置・日報・現場運営の把握',
    requiredCapabilities: ['deterministic_calc'],
    allowedTools: ['get_schedule', 'get_daily_reports'],
    riskLevel: 1,
    requiredEvidence: true,
    preferredProviders: ['deterministic'],
    memoryAccess: ['COMPANY', 'OPERATIONAL']
  },
  STRUCTURING: {
    ...base,
    roleId: 'STRUCTURING',
    description: '計画・手順・実行ステップへの構造化',
    requiredCapabilities: ['structured_output', 'reasoning'],
    allowedTools: [],
    riskLevel: 1,
    requiredEvidence: false,
    memoryAccess: ['COMPANY', 'OPERATIONAL']
  },
  RESEARCH: {
    ...base,
    roleId: 'RESEARCH',
    description: '外部調査（市場・競合・制度）。結果は社内事実と分離',
    requiredCapabilities: ['web_research', 'long_running'],
    allowedTools: ['request_research'],
    riskLevel: 1,
    requiredEvidence: true,
    preferredProviders: ['manus', 'anthropic'],
    memoryAccess: ['EXTERNAL'] // 給与等の社内機微は渡さない
  },
  WRITING: {
    ...base,
    roleId: 'WRITING',
    description: '文章・下書きの作成（送信は承認必須の別工程）',
    requiredCapabilities: ['writing'],
    allowedTools: ['create_draft'],
    riskLevel: 2,
    requiredEvidence: false,
    memoryAccess: ['COMPANY', 'OPERATIONAL']
  },
  INNOVATION: {
    ...base,
    roleId: 'INNOVATION',
    description: '創意工夫・前提挑戦・複数案生成',
    requiredCapabilities: ['reasoning'],
    allowedTools: ['innovation_engine', 'memory_search'],
    riskLevel: 1,
    requiredEvidence: false,
    memoryAccess: ['COMPANY', 'OPERATIONAL']
  },
  EXECUTION: {
    ...base,
    roleId: 'EXECUTION',
    description: '承認済みアクションの実行（Phase Nでもdry-run固定）',
    requiredCapabilities: ['tool_calling'],
    allowedTools: ['request_approval'],
    riskLevel: 4, // 必ず承認経由
    requiredEvidence: true,
    memoryAccess: ['OPERATIONAL']
  },
  MEMORY: {
    ...base,
    roleId: 'MEMORY',
    description: '過去の判断・教訓・類似事例の検索',
    requiredCapabilities: ['memory_access'],
    allowedTools: ['memory_search', 'memory_history'],
    riskLevel: 0,
    requiredEvidence: true,
    preferredProviders: ['deterministic'],
    memoryAccess: ['COMPANY', 'PRESIDENT', 'OPERATIONAL', 'EXTERNAL']
  },
  CRITIC: {
    ...base,
    roleId: 'CRITIC',
    description: '生成結果の検証（根拠・矛盾・リスク過小評価・反対意見）。答えを勝手に変更しない',
    requiredCapabilities: ['reasoning'],
    allowedTools: ['memory_search'],
    riskLevel: 1,
    requiredEvidence: false,
    preferredProviders: ['deterministic', 'anthropic'],
    memoryAccess: ['COMPANY', 'PRESIDENT']
  },
  SYNTHESIS: {
    ...base,
    roleId: 'SYNTHESIS',
    description: '複数Role結果の統合（結論→事実→分析→リスク→別案→推奨→次アクション）',
    requiredCapabilities: ['structured_output'],
    allowedTools: [],
    riskLevel: 1,
    requiredEvidence: false,
    preferredProviders: ['deterministic'],
    memoryAccess: ['COMPANY', 'OPERATIONAL']
  }
};
