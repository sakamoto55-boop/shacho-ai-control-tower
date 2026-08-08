/**
 * Universal Capability Registry（Phase X §15-§18・§39-§41）。
 *
 * LCC COMMANDが扱う「AI能力」の正本。Roleとは別の層で、
 * Role→Capability→Tool/Provider の中間にあたる。
 * - Providerは実装手段にすぎず固定しない（§17）。新Provider追加は登録のみ（§41）
 * - 利用可能Providerがある能力のみACTIVE。未接続はNOT_CONFIGURED（§50。エラーにしない）
 * - コスト（Execution Budget: LOW/NORMAL/DEEP/BUILD §39）と権限（§40）を宣言的に管理
 */

export type CapabilityId =
  | 'SEARCH_INTERNAL'
  | 'SEARCH_DRIVE'
  | 'SEARCH_EMAIL'
  | 'SEARCH_WEB'
  | 'DEEP_RESEARCH'
  | 'DATA_ANALYSIS'
  | 'FINANCIAL_ANALYSIS'
  | 'FORECASTING'
  | 'DOCUMENT_READ'
  | 'PDF_READ'
  | 'OCR'
  | 'IMAGE_ANALYSIS'
  | 'TEXT_GENERATION'
  | 'WRITING'
  | 'TRANSLATION'
  | 'SUMMARIZATION'
  | 'IMAGE_GENERATION'
  | 'DIAGRAM_GENERATION'
  | 'CHART_GENERATION'
  | 'DOCUMENT_CREATION'
  | 'SPREADSHEET_CREATION'
  | 'PDF_CREATION'
  | 'PRESENTATION_CREATION'
  | 'CODE_GENERATION'
  | 'SOFTWARE_ENGINEERING'
  | 'APP_BUILD'
  | 'WEB_BUILD'
  | 'GAS_BUILD'
  | 'AUTOMATION_BUILD'
  | 'API_BUILD'
  | 'EMAIL_DRAFT'
  | 'MESSAGE_DRAFT'
  | 'VOICE_INPUT'
  | 'VOICE_OUTPUT'
  | 'TASK_EXECUTION'
  | 'LONG_RUNNING_TASK'
  | 'CRITIC_REVIEW'
  // 見積Capability（§25。LCCの重要業務として正式登録）
  | 'SEARCH_CUSTOMER'
  | 'SEARCH_PROJECT'
  | 'SEARCH_SIMILAR_PROJECT'
  | 'SEARCH_UNIT_PRICE'
  | 'CREATE_ESTIMATE_DRAFT'
  | 'CALCULATE_MARGIN'
  | 'COMPARE_ESTIMATE'
  | 'GENERATE_ESTIMATE_DOCUMENT';

export type ExecutionBudget = 'LOW' | 'NORMAL' | 'DEEP' | 'BUILD';
export type DataClass = 'PUBLIC' | 'INTERNAL' | 'SENSITIVE';

export interface CapabilityDefinition {
  capabilityId: CapabilityId;
  description: string;
  /** 実装手段の候補（Provider Registry上のID。'deterministic'=社内決定論実装） */
  providers: string[];
  tools: string[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  requiredRoles: string[];
  allowedDataClasses: DataClass[];
  costClass: 'LOW' | 'MEDIUM' | 'HIGH';
  latencyClass: 'FAST' | 'MEDIUM' | 'SLOW';
  supportsAsync: boolean;
  supportsArtifacts: boolean;
  outputTypes: string[];
}

const D = 'deterministic';

function def(
  capabilityId: CapabilityId,
  description: string,
  overrides: Partial<CapabilityDefinition> = {}
): CapabilityDefinition {
  return {
    capabilityId,
    description,
    providers: [D],
    tools: [],
    riskLevel: 'LOW',
    requiredRoles: [],
    allowedDataClasses: ['INTERNAL'],
    costClass: 'LOW',
    latencyClass: 'FAST',
    supportsAsync: false,
    supportsArtifacts: false,
    outputTypes: ['TEXT'],
    ...overrides
  };
}

const LLM = ['anthropic', 'openai'];

export const CAPABILITIES: CapabilityDefinition[] = [
  def('SEARCH_INTERNAL', '社内データ（顧客・案件・Memory・カタログ）の統合検索'),
  def('SEARCH_DRIVE', 'Google Driveの検索（READ ONLY）', { providers: ['google-drive'], tools: ['drive.search'] }),
  def('SEARCH_EMAIL', 'Gmailの検索（READ ONLY）', { providers: ['gmail'], allowedDataClasses: ['INTERNAL', 'SENSITIVE'] }),
  def('SEARCH_WEB', 'Web検索', { providers: LLM, costClass: 'MEDIUM', latencyClass: 'MEDIUM' }),
  def('DEEP_RESEARCH', '外部深掘り調査（長時間・出典付き）', { providers: ['manus', ...LLM], costClass: 'HIGH', latencyClass: 'SLOW', supportsAsync: true }),
  def('DATA_ANALYSIS', '決定論エンジンによる集計・分析（AIに数値計算させない）'),
  def('FINANCIAL_ANALYSIS', '資金繰り・粗利・着地の決定論分析'),
  def('FORECASTING', 'Future Intelligence（30/90/180/365日の決定論予測）'),
  def('DOCUMENT_READ', '文書読解', { providers: LLM }),
  def('PDF_READ', 'PDF読解', { providers: LLM }),
  def('OCR', '画像内文字の読み取り（日報写真等）', { providers: LLM, costClass: 'MEDIUM' }),
  def('IMAGE_ANALYSIS', '画像分析', { providers: LLM, costClass: 'MEDIUM' }),
  def('TEXT_GENERATION', '文章生成', { providers: LLM, costClass: 'MEDIUM' }),
  def('WRITING', '業務文書ライティング', { providers: LLM, costClass: 'MEDIUM' }),
  def('TRANSLATION', '翻訳', { providers: LLM }),
  def('SUMMARIZATION', '要約', { providers: LLM }),
  def('IMAGE_GENERATION', '画像生成（ポスター・チラシ・図版）', { providers: ['image-provider'], costClass: 'HIGH', latencyClass: 'SLOW', supportsArtifacts: true, outputTypes: ['IMAGE'], riskLevel: 'MEDIUM' }),
  def('DIAGRAM_GENERATION', '構造図・フロー図の生成', { providers: [D, ...LLM], supportsArtifacts: true, outputTypes: ['DIAGRAM'] }),
  def('CHART_GENERATION', 'チャート生成（データは決定論集計）', { supportsArtifacts: true, outputTypes: ['CHART'] }),
  def('DOCUMENT_CREATION', 'Word文書の生成', { providers: ['doc-provider', ...LLM], costClass: 'MEDIUM', supportsArtifacts: true, outputTypes: ['DOCX'] }),
  def('SPREADSHEET_CREATION', 'Excelワークブックの生成', { providers: ['sheet-provider'], costClass: 'MEDIUM', supportsArtifacts: true, outputTypes: ['XLSX'] }),
  def('PDF_CREATION', 'PDFの生成', { providers: ['doc-provider'], supportsArtifacts: true, outputTypes: ['PDF'] }),
  def('PRESENTATION_CREATION', 'プレゼン資料の生成', { providers: ['slide-provider'], costClass: 'HIGH', latencyClass: 'SLOW', supportsAsync: true, supportsArtifacts: true, outputTypes: ['PPTX'] }),
  def('CODE_GENERATION', 'コード生成', { providers: LLM, costClass: 'MEDIUM' }),
  def('SOFTWARE_ENGINEERING', 'ソフトウェア設計・実装（重複チェック必須）', { providers: ['coding-agent', ...LLM], costClass: 'HIGH', latencyClass: 'SLOW', supportsAsync: true, supportsArtifacts: true, outputTypes: ['CODE', 'ZIP'], riskLevel: 'HIGH' }),
  def('APP_BUILD', '業務アプリ構築', { providers: ['coding-agent'], costClass: 'HIGH', latencyClass: 'SLOW', supportsAsync: true, supportsArtifacts: true, riskLevel: 'HIGH' }),
  def('WEB_BUILD', 'Webサイト/ページ構築', { providers: ['coding-agent'], costClass: 'HIGH', supportsAsync: true, supportsArtifacts: true, riskLevel: 'MEDIUM' }),
  def('GAS_BUILD', 'Google Apps Script構築', { providers: ['coding-agent'], costClass: 'HIGH', supportsAsync: true, supportsArtifacts: true, riskLevel: 'HIGH' }),
  def('AUTOMATION_BUILD', '業務自動化の構築', { providers: ['coding-agent'], costClass: 'HIGH', supportsAsync: true, riskLevel: 'HIGH' }),
  def('API_BUILD', 'API構築', { providers: ['coding-agent'], costClass: 'HIGH', supportsAsync: true, riskLevel: 'HIGH' }),
  def('EMAIL_DRAFT', 'メール下書き（送信はしない）', { providers: LLM, riskLevel: 'MEDIUM' }),
  def('MESSAGE_DRAFT', 'メッセージ下書き（送信はしない）', { providers: LLM, riskLevel: 'MEDIUM' }),
  def('VOICE_INPUT', '音声入力', { providers: ['voice-provider'] }),
  def('VOICE_OUTPUT', '音声出力', { providers: ['voice-provider'] }),
  def('TASK_EXECUTION', '承認済みタスクの実行（dry-run固定）', { riskLevel: 'HIGH' }),
  def('LONG_RUNNING_TASK', '長時間タスクの非同期実行', { supportsAsync: true }),
  def('CRITIC_REVIEW', '生成結果の検証（決定論Critic + LLM追加指摘）'),
  // 見積（§25）— 決定論実装
  def('SEARCH_CUSTOMER', '顧客検索'),
  def('SEARCH_PROJECT', '案件検索'),
  def('SEARCH_SIMILAR_PROJECT', '類似案件検索（工種別）'),
  def('SEARCH_UNIT_PRICE', '過去実績からの単価参照'),
  def('CREATE_ESTIMATE_DRAFT', '見積草案の作成（金額確定は決定論計算）'),
  def('CALCULATE_MARGIN', '粗利の決定論計算'),
  def('COMPARE_ESTIMATE', '見積の比較'),
  def('GENERATE_ESTIMATE_DOCUMENT', '見積書ドキュメント生成', { providers: ['doc-provider'], supportsArtifacts: true, outputTypes: ['PDF', 'XLSX'] })
];

/** Provider接続状態からCapabilityの利用可否を決める（§50） */
export function capabilityStatus(
  definition: CapabilityDefinition,
  availableProviders: Set<string>
): 'ACTIVE' | 'NOT_CONFIGURED' {
  return definition.providers.some((p) => availableProviders.has(p)) ? 'ACTIVE' : 'NOT_CONFIGURED';
}

/** 現時点で利用可能なProvider集合（決定論実装は常時利用可能） */
export function availableProvidersFromEnv(env = process.env): Set<string> {
  const set = new Set<string>([D]);
  if (env.ANTHROPIC_API_KEY) set.add('anthropic');
  if (env.OPENAI_API_KEY) set.add('openai');
  if (env.MANUS_API_KEY) set.add('manus');
  // 生成系（image/slide/sheet/doc/coding/voice）・Drive/Gmail実行時接続は未設定=NOT_CONFIGURED
  return set;
}

export interface CapabilityRoute {
  capabilities: CapabilityId[];
  budget: ExecutionBudget;
  /** 権限要件（§40）。該当なしはundefined */
  permission?: {
    requiredRole?: 'PRESIDENT';
    requiresApproval?: boolean;
    reason: string;
  };
  /** 生成Artifactの型（生成依頼の場合） */
  artifactType?: 'PPTX' | 'XLSX' | 'DOCX' | 'PDF' | 'IMAGE' | 'DIAGRAM' | 'CODE';
}

/** User RequestからCapability連鎖・Budget・権限要件を決める（§18・§39-§40） */
export function routeCapabilities(message: string): CapabilityRoute {
  const sensitive = /給与|賞与|年収|人件費単価|口座|評価/.test(message);
  const publish = /公開|配布|外部|SNS|ホームページに載せ/.test(message);
  const permission = sensitive
    ? { requiredRole: 'PRESIDENT' as const, reason: '給与等の機微データを含むためPRESIDENT権限が必要です' }
    : publish
      ? { requiresApproval: true, reason: '外部公開物のため承認が必要です' }
      : undefined;

  if (/アプリ(にして|化|作って)|システム(にして|化)|自動化して|ツール作って|GAS/.test(message)) {
    return {
      capabilities: ['SEARCH_INTERNAL', 'SOFTWARE_ENGINEERING', 'APP_BUILD', 'CRITIC_REVIEW'],
      budget: 'BUILD',
      permission: { requiresApproval: true, reason: '本番Deployは承認が必要です（設計・比較まではAIが実施）' },
      artifactType: 'CODE'
    };
  }
  if (/プレゼン|スライド|パワポ|発表資料/.test(message)) {
    return {
      capabilities: ['SEARCH_INTERNAL', 'DATA_ANALYSIS', 'SUMMARIZATION', 'CHART_GENERATION', 'PRESENTATION_CREATION', 'CRITIC_REVIEW'],
      budget: 'DEEP',
      permission,
      artifactType: 'PPTX'
    };
  }
  if (/(Excel|エクセル|スプレッドシート|表計算)(で|に|化|にして|作って)/i.test(message)) {
    return {
      capabilities: ['SEARCH_INTERNAL', 'DATA_ANALYSIS', 'SPREADSHEET_CREATION', 'CRITIC_REVIEW'],
      budget: 'NORMAL',
      permission,
      artifactType: 'XLSX'
    };
  }
  if (/(画像|ポスター|チラシ|イラスト|漫画|バナー)(を|で)?.{0,6}(作|生成|描)/.test(message)) {
    return {
      capabilities: ['SEARCH_INTERNAL', 'WRITING', 'IMAGE_GENERATION'],
      budget: 'DEEP',
      permission,
      artifactType: 'IMAGE'
    };
  }
  if (/図にして|図解|フロー図|構成図/.test(message)) {
    return { capabilities: ['SEARCH_INTERNAL', 'DIAGRAM_GENERATION'], budget: 'NORMAL', permission, artifactType: 'DIAGRAM' };
  }
  if (/(PDF|Word|ワード|文書|資料)(にして|化|作って|で作)/i.test(message)) {
    return {
      capabilities: ['SEARCH_INTERNAL', 'WRITING', /PDF/i.test(message) ? 'PDF_CREATION' : 'DOCUMENT_CREATION', 'CRITIC_REVIEW'],
      budget: 'NORMAL',
      permission,
      artifactType: /PDF/i.test(message) ? 'PDF' : 'DOCX'
    };
  }
  if (/見積(案|書)?.{0,4}(作|出し)/.test(message)) {
    return {
      capabilities: ['SEARCH_CUSTOMER', 'SEARCH_PROJECT', 'SEARCH_SIMILAR_PROJECT', 'SEARCH_UNIT_PRICE', 'CREATE_ESTIMATE_DRAFT', 'CALCULATE_MARGIN'],
      budget: 'NORMAL',
      permission
    };
  }
  if (/徹底的|深く調べ|Webで調べ|外部.{0,4}調査/.test(message)) {
    return { capabilities: ['SEARCH_INTERNAL', 'DEEP_RESEARCH'], budget: 'DEEP', permission };
  }
  if (/どこ(にある|だっけ|？|\?)|探して/.test(message)) {
    return { capabilities: ['SEARCH_INTERNAL', 'SEARCH_DRIVE'], budget: 'LOW', permission };
  }
  return { capabilities: ['SEARCH_INTERNAL', 'DATA_ANALYSIS'], budget: 'LOW', permission };
}
