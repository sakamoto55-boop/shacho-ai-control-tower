/**
 * Internal Search Super Layer（Phase X §27-§30）。
 *
 * 社内検索の統合層。「会社のどこにある？」に答える。
 * - 対象: LCC COMMANDデータ（顧客・案件）、Memory、正本カタログ（Drive実測済み資料）
 * - 結果は統一Schema（§28）。権限（People OS等）はここで強制する
 * - 見つからない場合は正直に「見つからない」（推測でパスを作らない）
 * - 外部Researchは社内検索で不足する場合のみ（§30。既存Research Routerが担当）
 */
import type { CommandDataset } from '../data/seed.js';
import type { DataConfidence, Principal } from '../domain/types.js';
import type { MemoryRecord } from '../memory/types.js';
import type { ArtifactRecord } from '../artifacts/artifactRegistry.js';

export interface UnifiedSearchResult {
  source: string;
  entity: 'CUSTOMER' | 'PROJECT' | 'MEMORY' | 'DOCUMENT' | 'SYSTEM' | 'ARTIFACT';
  title: string;
  date?: string;
  freshness: 'FRESH' | 'STALE' | 'VERY_STALE' | 'UNKNOWN';
  confidence: DataConfidence;
  permission: 'ALL' | 'PRESIDENT';
  snippet: string;
  reference: string;
}

/**
 * 正本カタログ（B0〜Xの READ ONLY 実測で確定した実在資料）。
 * 「第13期経営計画書どれ？」等に正本判定付きで答えるための静的カタログ。
 */
export const SOURCE_CATALOG: UnifiedSearchResult[] = [
  {
    source: 'Google Sheets',
    entity: 'DOCUMENT',
    title: 'LCC 経営の聖書 第13期 v7 社長用（系列中最新の正本候補）',
    date: '2026-06-04',
    freshness: 'FRESH',
    confidence: 'HIGH',
    permission: 'ALL',
    snippet: '第13期の経営管理正本候補。武蔵野式3段管理・目標値・粗利管理ルールX2。旧版（v5/v8.xlsx/正式版/会議体系再構築版）は更新日時がこれより古い',
    reference: 'spreadsheet:1qpfTv1U5qR4nBzgqAmXa7YSoL9EISifTzjRUukY3hlM'
  },
  {
    source: 'Google Drive',
    entity: 'DOCUMENT',
    title: '（LCC様）第13期 経営計画書（3校）.pdf（印刷版の最終校）',
    date: '2026-04-01',
    freshness: 'STALE',
    confidence: 'HIGH',
    permission: 'ALL',
    snippet: '印刷用経営計画書の第3校。理念・方針の正式文書候補（数値の最新性は経営の聖書v7が優先）',
    reference: 'drive:1GzykTkpdTIEZlCRkFjpJfEHHwsVd7MJ6'
  },
  {
    source: 'Google Sheets',
    entity: 'SYSTEM',
    title: 'LCC統合業務システムDB（顧客・案件の正本）',
    date: '2026-07-20',
    freshness: 'FRESH',
    confidence: 'HIGH',
    permission: 'ALL',
    snippet: '顧客2,268件・案件2,459件。lcc.html（統合見積システム）が読み書きする正本',
    reference: 'spreadsheet:1jOU-Kq8vh7Meaa7auNQqVflseRAPCcGzksAsvG-16HY'
  },
  {
    source: 'Google Sheets',
    entity: 'SYSTEM',
    title: 'LCCデジタル配置板DB（社員・車両・協力会社マスタ）',
    date: '2026-08-04',
    freshness: 'FRESH',
    confidence: 'HIGH',
    permission: 'ALL',
    snippet: '社員60名・車両27台・協力会社6社。配置・日報タブは未稼働（実運用はホワイトボード写真→AI読み取り）',
    reference: 'spreadsheet:1LLJTDr-gAha0F3l5AaxbPUrYiQUA5QPKR0qRXbHBVC8'
  },
  {
    source: 'Google Sheets',
    entity: 'SYSTEM',
    title: '日報データ（AI読み取り）— 実績日報のドラフト正本',
    date: '2026-08-07',
    freshness: 'FRESH',
    confidence: 'MEDIUM',
    permission: 'ALL',
    snippet: 'ホワイトボード写真をAIが読み取った日報（工数・信頼度・確認ステータス付き）。確定✔行のみ実績候補',
    reference: 'spreadsheet:19nu2KzprKgf5NOLxsgh-TXaau0zkjisx3d19Eia5MZ8'
  },
  {
    source: 'Google Drive',
    entity: 'DOCUMENT',
    title: 'LCC_People_OS_統合マスタ_v17（給与・人事の正本）',
    date: '2026-07-26',
    freshness: 'FRESH',
    confidence: 'HIGH',
    permission: 'PRESIDENT',
    snippet: '高機密。給与制度の正本宣言あり（在籍49名）。閲覧はPRESIDENT権限のみ・LCC COMMANDへ実値は複製しない',
    reference: 'drive:1E2U9opV2ucLtsXrsr6jXPvU8pL_iDjwP'
  },
  {
    source: 'LCC_CASE_DB',
    entity: 'SYSTEM',
    title: 'LCC_CASE_DB（法定書類の期限管理・案件は派生）',
    date: '2026-07-31',
    freshness: 'FRESH',
    confidence: 'MEDIUM',
    permission: 'ALL',
    snippet: '解体届出・石綿事前調査・マニフェスト117行（全行要確認）。案件データは統合業務システムの派生',
    reference: 'spreadsheet:1fU-QEnWnfE6AwWIV2wuiK1pERY5HbGPJ0GTMC0hPaJs'
  }
];

/** 日本語クエリ対応: カタログ側の語（タイトル・要約の3文字以上の区切り語）がクエリに含まれるかで照合する */
function significantTerms(...texts: string[]): string[] {
  return texts
    .flatMap((text) => text.split(/[\s()（）・、。「」/:：_—-]+/))
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
}

export function unifiedSearch(
  dataset: CommandDataset,
  memories: MemoryRecord[],
  query: string,
  principal: Principal,
  artifacts: ArtifactRecord[] = []
): UnifiedSearchResult[] {
  const results: UnifiedSearchResult[] = [];

  // 生成済みArtifact（§30: 「前に作った○○どれ？」に答える）
  for (const artifact of artifacts) {
    const terms = artifact.title.match(/[一-龠ァ-ヶーA-Za-z0-9]{2,}/g) ?? [];
    if (terms.some((term) => term.length >= 2 && query.includes(term))) {
      results.push({
        source: 'Artifact Registry',
        entity: 'ARTIFACT',
        title: `${artifact.title}（${artifact.type} v${artifact.version}）`,
        date: artifact.createdAt.slice(0, 10),
        freshness: 'FRESH',
        confidence: 'HIGH',
        permission: 'ALL',
        snippet: `状態: ${artifact.status}${artifact.storageLocation ? ` / ${artifact.storageLocation}` : ''}`,
        reference: artifact.artifactId
      });
    }
  }

  // 正本カタログ（権限フィルタをここで強制。§27 People OSはPRESIDENTのみ）
  for (const item of SOURCE_CATALOG) {
    if (item.permission === 'PRESIDENT' && principal.role !== 'PRESIDENT') continue;
    if (significantTerms(item.title, item.snippet).some((term) => query.includes(term))) {
      results.push(item);
    }
  }
  // 顧客・案件（名称の先頭をクエリが含むか）
  const nameMatch = (name: string) => {
    const base = name.replace(/株式会社|（.+）/g, '');
    return base.length >= 2 && query.includes(base.slice(0, Math.min(3, base.length)));
  };
  for (const customer of dataset.customers) {
    if (nameMatch(customer.name)) {
      results.push({
        source: '統合業務システム（Canonical）',
        entity: 'CUSTOMER',
        title: customer.name,
        freshness: 'FRESH',
        confidence: 'HIGH',
        permission: 'ALL',
        snippet: `顧客ID ${customer.customerId}`,
        reference: customer.customerId
      });
    }
  }
  for (const project of dataset.projects) {
    if (nameMatch(project.name)) {
      results.push({
        source: '統合業務システム（Canonical）',
        entity: 'PROJECT',
        title: project.name,
        date: project.updatedAt?.slice(0, 10),
        freshness: 'FRESH',
        confidence: 'HIGH',
        permission: 'ALL',
        snippet: `ステージ: ${project.stage}`,
        reference: project.projectId
      });
    }
  }
  // Memory（ACTIVEのみ。層のRBACは呼び出し元でsearch済み前提だがタイトル一致のみ返す）
  for (const memory of memories) {
    const memoryTerms = memory.statement.match(/[一-龠ァ-ヶー]{3,}/g) ?? [];
    if (memory.status === 'ACTIVE' && memoryTerms.some((term) => query.includes(term))) {
      results.push({
        source: 'LCC COMMAND Memory',
        entity: 'MEMORY',
        title: memory.statement.slice(0, 60),
        date: memory.createdAt.slice(0, 10),
        freshness: 'FRESH',
        confidence: 'MEDIUM',
        permission: 'ALL',
        snippet: `[${memory.type}]`,
        reference: memory.memoryId
      });
    }
  }
  return results.slice(0, 10);
}
