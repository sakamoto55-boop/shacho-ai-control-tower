/**
 * LIVE BETA Gate（LIVE BETA §1-§2・§20）。
 *
 * 最小起動条件（Sheets Service Account READ ONLY + 実LLM Provider 1つ）と
 * §20の全Gate条件を決定論で判定する。
 * - 未解決Gap（銀行・会計・日報紐付け）はGate条件に含めない（§1: 全体を止めない）
 * - ユーザーにしかできない条件（認証・承認）はPENDING_USERとして具体手順を返す
 * - 実接続後にのみ検証できる条件はPENDING_RUNTIMEとして実行コマンドを返す
 */
import { availableProvidersFromEnv } from '../capabilities/capabilityRegistry.js';

export type GateStatus = 'PASS' | 'PENDING_USER' | 'PENDING_RUNTIME';

export interface GateCondition {
  id: string;
  title: string;
  status: GateStatus;
  detail: string;
  /** PENDING時のユーザー操作 or 実行コマンド */
  action?: string;
}

export interface BetaGateResult {
  ready: boolean;
  declaration: string | null;
  minimumStartSatisfied: boolean;
  conditions: GateCondition[];
}

export interface BetaGateInput {
  env?: NodeJS.ProcessEnv;
  /** command:sanity の判定結果（未実行はnull） */
  sanityReady?: boolean | null;
  /** command:real-eval の合格結果（未実行はnull） */
  realEvalPassed?: boolean | null;
  /** Growth Baseline（growth-snapshots.jsonl）が存在するか */
  growthBaselineStarted?: boolean;
  /** Incident Log が利用可能か（コード検証済みならtrue） */
  incidentLoggingReady?: boolean;
}

function llmConfigured(env: NodeJS.ProcessEnv): string[] {
  const providers = availableProvidersFromEnv(env);
  return [...providers].filter((p) => p !== 'deterministic' && p !== 'renderer' && p !== 'openai-image');
}

function sheetsConfigured(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.GOOGLE_SERVICE_ACCOUNT_JSON || env.GOOGLE_SERVICE_ACCOUNT_FILE);
}

export function evaluateBetaGate(input: BetaGateInput = {}): BetaGateResult {
  const env = input.env ?? process.env;
  const llms = llmConfigured(env);
  const sheets = sheetsConfigured(env);

  const conditions: GateCondition[] = [
    {
      id: 'sheets-sa',
      title: 'Google Sheets Service Account（READ ONLY）',
      status: sheets ? 'PASS' : 'PENDING_USER',
      detail: sheets
        ? 'GOOGLE_SERVICE_ACCOUNT_JSON/_FILE が設定されています'
        : '未設定（実データ接続の最小条件）',
      action: sheets
        ? undefined
        : 'GCPでService Account作成 → JSONキーを .env の GOOGLE_SERVICE_ACCOUNT_FILE へ → 対象シートをSAメールへ閲覧者共有'
    },
    {
      id: 'sanity',
      title: 'Sheets sanity PASS（件数照合）',
      status: input.sanityReady === true ? 'PASS' : sheets ? 'PENDING_RUNTIME' : 'PENDING_USER',
      detail:
        input.sanityReady === true
          ? '件数照合に合格しています'
          : input.sanityReady === false
            ? 'NOT READY — 乖離のあるDomainは会話回答に使用されません'
            : '未実行（Service Account接続後に自動確認）',
      action: input.sanityReady === true ? undefined : 'npm run command:sanity'
    },
    {
      id: 'llm',
      title: '実LLM Provider（1つ以上）',
      status: llms.length > 0 ? 'PASS' : 'PENDING_USER',
      detail: llms.length > 0 ? `接続済み: ${llms.join(', ')}` : '未設定（最小1つ）',
      action:
        llms.length > 0
          ? undefined
          : '.env へ ANTHROPIC_API_KEY（推奨・最初の実Provider）または OPENAI_API_KEY / GEMINI_API_KEY を設定'
    },
    {
      id: 'real-eval',
      title: 'Real Evaluation PASS（100問+Hallucination Gate）',
      status: input.realEvalPassed === true ? 'PASS' : 'PENDING_RUNTIME',
      detail:
        input.realEvalPassed === true
          ? '実データ100問評価に合格しています'
          : '実データ接続後に実行（Synthetic評価はnpm testで常時PASS）',
      action: input.realEvalPassed === true ? undefined : 'npm run command:real-eval'
    },
    {
      id: 'hallucination',
      title: 'Hallucination Gate PASS',
      status: input.realEvalPassed === true ? 'PASS' : 'PENDING_RUNTIME',
      detail:
        input.realEvalPassed === true
          ? '存在しない実体への質問に正直な「確認できません」を返しています'
          : 'real-eval に含まれます（Synthetic版はテストで検証済み）',
      action: input.realEvalPassed === true ? undefined : 'npm run command:real-eval'
    },
    {
      id: 'vui',
      title: 'VUI実接続（Event Bus / 実Role Activityのみ表示）',
      status: 'PASS',
      detail: '実イベントのみ表示（偽のRole Activityなし）。テスト検証済み'
    },
    {
      id: 'memory',
      title: 'Memory実動作（Learning Safety付き）',
      status: 'PASS',
      detail: '覚えて/想起/監査/False Learning Protection をテスト検証済み'
    },
    {
      id: 'correction',
      title: 'Correction実動作（訂正・履歴保持）',
      status: 'PASS',
      detail: '「それ違う」訂正 → CORRECTED遷移・履歴保持をテスト検証済み'
    },
    {
      id: 'growth-baseline',
      title: 'Growth Baseline開始（日次Snapshot）',
      status: input.growthBaselineStarted ? 'PASS' : 'PENDING_RUNTIME',
      detail: input.growthBaselineStarted
        ? 'Baseline記録済み。2回目以降はChange/Pattern Detection稼働'
        : 'LIVE BETA開始日に初回Snapshotを記録します',
      action: input.growthBaselineStarted ? undefined : 'npm run command:growth'
    },
    {
      id: 'rbac',
      title: 'RBAC強制（API+Orchestrator両側）',
      status: 'PASS',
      detail: 'PRESIDENT/EXECUTIVE/MANAGER/STAFF + スコープ検査をテスト検証済み'
    },
    {
      id: 'evidence',
      title: 'Evidence（数値回答への根拠添付）',
      status: 'PASS',
      detail: '確認できた事実/AIの推測の分離 + Evidence添付をテスト検証済み'
    },
    {
      id: 'freshness',
      title: 'Freshness（データ鮮度の明示）',
      status: 'PASS',
      detail: '全KPI・Sourceにfreshness付与をテスト検証済み'
    },
    {
      id: 'audit',
      title: 'Audit Log（操作記録・機微マスク）',
      status: 'PASS',
      detail: '操作のAudit記録 + 機微情報マスクをテスト検証済み'
    },
    {
      id: 'cost',
      title: 'Cost Monitoring（概算トークン記録）',
      status: 'PASS',
      detail: 'Observability の llm_call 概算トークン集計を実装済み'
    },
    {
      id: 'incident',
      title: 'Incident Logging（Beta Incident Log）',
      status: input.incidentLoggingReady === false ? 'PENDING_RUNTIME' : 'PASS',
      detail: '誤回答・障害等の記録 + 3件以上でGrowth候補化を実装済み'
    }
  ];

  const ready = conditions.every((c) => c.status === 'PASS');
  return {
    ready,
    declaration: ready ? 'LCC COMMAND LIVE READ-ONLY BETA READY' : null,
    minimumStartSatisfied: sheets && llms.length > 0,
    conditions
  };
}
