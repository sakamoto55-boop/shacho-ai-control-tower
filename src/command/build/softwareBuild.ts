/**
 * Software Build Capability（Phase X §23-§24）。
 *
 * 「この業務をアプリにして」への構造的応答。
 * - 必ず既存システム検索（重複チェック）を先に行う。「作れるから作る」を禁止（§24）
 * - Company Constitution（正本は1つ・転記を増やさない）と照合（§7・§46）
 * - 新規作成/既存改修/統合/廃止を比較提示する
 * - Phase Xでは設計・比較までで、本番Deployは承認なしで行わない
 */

export interface KnownSystem {
  key: string;
  name: string;
  kind: 'WebApp' | 'GAS' | 'Sheets' | 'API';
  covers: string[];
  status: '稼働中' | '構築済み・未稼働' | '派生';
  reference: string;
}

/** 既存システムカタログ（B0〜X READ ONLY実測で確認済み） */
export const KNOWN_SYSTEMS: KnownSystem[] = [
  {
    key: 'integrated-os',
    name: 'LCC統合業務システム（lcc.html + 統合業務システムDB）',
    kind: 'WebApp',
    covers: ['見積', '顧客', '案件', '受注', '請求', '承認'],
    status: '稼働中',
    reference: 'docs/lcc.html / spreadsheet:1jOU-Kq8…'
  },
  {
    key: 'cost-app',
    name: 'LCC原価管理（lcc-cost.html）',
    kind: 'WebApp',
    covers: ['原価', '日報', '請求書'],
    status: '稼働中',
    reference: 'docs/lcc-cost.html'
  },
  {
    key: 'haichi-board',
    name: 'LCCデジタル配置板（GAS + 配置板DB）',
    kind: 'GAS',
    covers: ['配置', '段取り', '車両', '社員', '現場'],
    status: '構築済み・未稼働',
    reference: 'GAS: LCCデジタル配置板 / spreadsheet:1LLJTDr…'
  },
  {
    key: 'nippo-ai',
    name: '日報データ（AI読み取り）',
    kind: 'Sheets',
    covers: ['日報', '工数', '人工', '写真読み取り'],
    status: '稼働中',
    reference: 'spreadsheet:19nu2Kzpr…'
  },
  {
    key: 'case-db',
    name: 'LCC_CASE_DB（法定書類管理）',
    kind: 'Sheets',
    covers: ['解体届出', '石綿', 'マニフェスト', '法定書類'],
    status: '派生',
    reference: 'spreadsheet:1fU-QEnW…'
  },
  {
    key: 'keiei-bible',
    name: '経営の聖書 第13期（v7社長用）',
    kind: 'Sheets',
    covers: ['経営管理', '月次実績', 'スコアボード', '年計', '信号'],
    status: '稼働中',
    reference: 'spreadsheet:1qpfTv1U5…'
  },
  {
    key: 'lcc-command',
    name: 'LCC COMMAND（本システム）',
    kind: 'API',
    covers: ['経営分析', '資金繰り', 'アラート', 'Memory', 'Brief', '会話'],
    status: '稼働中',
    reference: 'src/command/'
  }
];

export interface DuplicateCheckResult {
  duplicates: KnownSystem[];
  recommendation: '新規作成' | '既存改修' | '統合' | '要検討';
}

export function checkDuplicates(request: string): DuplicateCheckResult {
  const duplicates = KNOWN_SYSTEMS.filter((sys) => sys.covers.some((c) => request.includes(c)));
  const recommendation =
    duplicates.length === 0 ? '新規作成' : duplicates.some((d) => d.status === '稼働中') ? '既存改修' : '統合';
  return { duplicates, recommendation };
}

export interface SoftwareBuildPlan {
  steps: Array<{ step: number; name: string; note: string }>;
  duplicateCheck: DuplicateCheckResult;
  constitutionWarnings: string[];
  options: Array<{ option: string; pros: string; cons: string }>;
  executable: boolean;
  lines: string[];
}

export function buildSoftwarePlan(
  request: string,
  constitutionWarnings: string[]
): SoftwareBuildPlan {
  const duplicateCheck = checkDuplicates(request);
  const steps = [
    { step: 1, name: 'Problem Definition', note: '解決したい業務課題の確定' },
    { step: 2, name: 'Existing System Search', note: `既存システム照合（${duplicateCheck.duplicates.length}件該当）` },
    { step: 3, name: 'Duplicate Check', note: `推奨: ${duplicateCheck.recommendation}` },
    { step: 4, name: 'Current Workflow', note: '現行業務フローの確認（Data Stewardship参照）' },
    { step: 5, name: 'Requirements', note: '要件定義（入力・出力・権限・正本）' },
    { step: 6, name: 'Constitution Check', note: constitutionWarnings.length > 0 ? '会社原則との矛盾あり（下記）' : '会社原則との矛盾なし' },
    { step: 7, name: 'Architecture', note: '既存正本への接続を優先（新DB乱立禁止）' },
    { step: 8, name: 'Build Provider', note: 'コーディングAgent選定（現在NOT_CONFIGURED）' },
    { step: 9, name: 'Test / Review', note: '決定論テスト + Critic' },
    { step: 10, name: 'Artifact / Repository', note: '成果物登録（本番DeployはPhase Xでは承認なしで行わない）' }
  ];
  const options: SoftwareBuildPlan['options'] = [];
  for (const dup of duplicateCheck.duplicates.slice(0, 2)) {
    options.push({
      option: `既存改修: ${dup.name}`,
      pros: '正本を増やさない・学習コスト小・データ連携済み',
      cons: '既存実装の制約を受ける'
    });
  }
  options.push({
    option: '新規作成',
    pros: '要件に最適化できる',
    cons: duplicateCheck.duplicates.length > 0 ? '正本・アプリの乱立リスク（会社原則候補に抵触の可能性）' : '構築・運用コスト'
  });

  const lines = [
    '【アプリ化のご依頼 — 作る前の確認】',
    duplicateCheck.duplicates.length > 0
      ? `同じ領域を扱う既存システムが${duplicateCheck.duplicates.length}件あります:`
      : '同じ領域の既存システムは見つかりませんでした。',
    ...duplicateCheck.duplicates.map((d) => `・${d.name}（${d.status}）— カバー範囲: ${d.covers.join('/')}`),
    '',
    ...(constitutionWarnings.length > 0 ? ['【会社原則との照合】', ...constitutionWarnings.map((w) => `⚠ ${w}`), ''] : []),
    '【選択肢の比較】',
    ...options.map((o) => `・${o.option}\n  利点: ${o.pros} / 留意: ${o.cons}`),
    '',
    `【推奨】まず「${duplicateCheck.recommendation}」を検討することを推奨します。`,
    '進める場合は要件定義から着手します（実装Agentは未接続のため、接続後にBuildを実行できます）。'
  ];

  return { steps, duplicateCheck, constitutionWarnings, options, executable: false, lines };
}
