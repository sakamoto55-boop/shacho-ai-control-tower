import 'dotenv/config';
/**
 * 正式配布パッケージ用の成果物3点（PPTX/XLSX/PDF）を単一Snapshotから生成する（是正⑥/夜間最終走行）。
 *
 * - Sheets実データを1回だけ取得し、件数（顧客2,268/案件2,459）と
 *   sourceRecordUpdatedAt（2026-06-29T09:30:07.000Z）を検証する。
 *   不一致なら SOURCE STATE CHANGED で停止（exit 2）。
 * - 3成果物は同じ SnapshotStamp（同一Snapshot Object）から生成する。成果物ごとの再取得はしない。
 * - SNAPSHOT_EVIDENCE: Sourceごとの行数・列数・列構成SHA-256・canonical content SHA-256を記録。
 *   canonical化: UTF-8 / LF / 列順=キー昇順固定 / 行順=ID昇順固定 / null保持（空文字と区別）/
 *   日時ISO 8601 / 数値はJSON表現 / JSON key順固定。生セル値・顧客名はEvidenceへ出さない。
 * - 出力先は LCC_ARTIFACT_DIR（Git管理外）。
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createCommandRepository } from '../src/command/repositories/CommandRepository.js';
import {
  buildSnapshotStamp,
  buildManagementDeckSpec,
  buildProjectLedgerWorkbookSpec,
  buildReportDocumentSpec
} from '../src/command/artifacts/contentBuilders.js';
import { renderPresentation, renderWorkbook, renderPdf } from '../src/command/artifacts/renderers.js';

const EXPECTED_CUSTOMERS = 2268;
const EXPECTED_PROJECTS = 2459;
const EXPECTED_SOURCE_RECORD_UPDATED_AT = '2026-06-29T09:30:07.000Z';

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

/** 行配列のcanonical content hash（列順=キー昇順・行順=id昇順・null保持・LF区切り） */
function canonicalize(rows: Array<Record<string, unknown>>, idKey: string): {
  rowCount: number;
  columnCount: number;
  columnStructureSha256: string;
  canonicalContentSha256: string;
} {
  const columns = Array.from(new Set(rows.flatMap((r) => Object.keys(r)))).sort();
  const sortedRows = [...rows].sort((a, b) => String(a[idKey] ?? '').localeCompare(String(b[idKey] ?? '')));
  const lines = sortedRows.map((row) =>
    JSON.stringify(
      columns.map((c) => {
        const v = row[c];
        if (v === undefined || v === null) return null; // nullと空文字を区別して保持
        if (v instanceof Date) return v.toISOString();
        return v;
      })
    )
  );
  return {
    rowCount: rows.length,
    columnCount: columns.length,
    columnStructureSha256: sha256(columns.join('\n')),
    canonicalContentSha256: sha256(lines.join('\n'))
  };
}

/**
 * 出所表記のdelivery側正規化（コード凍結のためsrcは変更せずSpec文字列だけを是正する）。
 * - 「source: X / 更新 <取得時刻> / OK」は取得時刻をデータ更新と誤読させるため「取得」へ変更。
 * - 「freshness: <取得時刻> 以降」はdataUpdated基準のVERY_STALE表記へ変更。
 * 表示文字列のみの変換であり、数値・判定ロジックには一切触れない。
 */
function fixProvenanceStrings<T>(spec: T, sourceRecordUpdatedAt: string): T {
  const fix = (value: unknown): unknown => {
    if (typeof value === 'string') {
      let s = value;
      s = s.replace(/ \/ 更新 (20[0-9-T:.Z]+)/gu, ' / 取得 $1');
      s = s.replace(
        /freshness: 20[0-9-T:.Z]+ 以降/gu,
        `freshness: dataUpdated ${sourceRecordUpdatedAt} 基準（VERY_STALE・データ実更新から41日超）`
      );
      return s;
    }
    if (Array.isArray(value)) return value.map(fix);
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = fix(v);
      return out;
    }
    return value;
  };
  return fix(spec) as T;
}

async function main(): Promise<void> {
  const repository = createCommandRepository();
  const asOf = new Date().toISOString();
  const dataset = await repository.getDataset(asOf); // Sheets取得はこの1回のみ
  console.log(`[delivery-artifacts] mode=${repository.mode} asOf=${asOf}`);

  const customers = dataset.customers.length;
  const projects = dataset.projects.length;
  console.log(`[delivery-artifacts] customers=${customers} projects=${projects}`);

  const scope = 'lcc' as Parameters<typeof buildSnapshotStamp>[1];
  const stamp = buildSnapshotStamp(dataset, scope);
  console.log(`[delivery-artifacts] snapshotId=${stamp.snapshotId}`);
  console.log(`[delivery-artifacts] sourceRecordUpdatedAt=${stamp.sourceRecordUpdatedAt}`);
  console.log(`[delivery-artifacts] snapshotFetchedAt=${stamp.snapshotFetchedAt}`);

  if (
    repository.mode !== 'production' ||
    customers !== EXPECTED_CUSTOMERS ||
    projects !== EXPECTED_PROJECTS ||
    stamp.sourceRecordUpdatedAt !== EXPECTED_SOURCE_RECORD_UPDATED_AT
  ) {
    console.error('[delivery-artifacts] SOURCE STATE CHANGED — 期待値と不一致のため停止します。');
    console.error(
      `  mode=${repository.mode} expected customers=${EXPECTED_CUSTOMERS} projects=${EXPECTED_PROJECTS} sourceRecordUpdatedAt=${EXPECTED_SOURCE_RECORD_UPDATED_AT}`
    );
    process.exitCode = 2;
    return;
  }

  // 同一Snapshot Object（同じdataset+stamp）から3点を構築（再取得しない）
  const deckSpec = fixProvenanceStrings(buildManagementDeckSpec(dataset, scope, stamp), stamp.sourceRecordUpdatedAt);
  const ledgerSpec = fixProvenanceStrings(buildProjectLedgerWorkbookSpec(dataset, scope, stamp), stamp.sourceRecordUpdatedAt);
  const reportSpec = fixProvenanceStrings(buildReportDocumentSpec(dataset, scope, stamp), stamp.sourceRecordUpdatedAt);

  const base = (kind: string): string => `${kind}_${stamp.snapshotId}_v4`;
  const pptxPath = await renderPresentation(deckSpec, base('LCC経営会議デッキ'));
  const xlsxPath = await renderWorkbook(ledgerSpec, base('LCC案件台帳'));
  const pdfPath = await renderPdf(reportSpec, base('LCC経営報告'));

  // 機械検査: 禁止表現がSpecに含まれないこと
  const specText = JSON.stringify({ deckSpec, ledgerSpec, reportSpec });
  const forbidden = [
    '着地予測: 0円',
    '着地予測0円',
    '着地予測（参考値）は0円',
    '着地予測（参考値）0円',
    '受注残: 0円',
    '受注残0円',
    '金額確認済0件（0円）',
    '営業要対応91件',
    'confidence HIGH',
    'ProjectSource更新 2026-08',
    '/ 更新 2026-08',
    ' 以降 / confidence',
    'snap-df4dca5099'
  ];
  const hits = forbidden.filter((f) => specText.includes(f));
  const required = [
    '算出不能（金額確認済0/91件・カバレッジ0%）',
    '次工程未設定候補 91件（status=contractの意味確認待ち）',
    EXPECTED_SOURCE_RECORD_UPDATED_AT
  ];
  const missing = required.filter((r) => !specText.includes(r));

  const evidence = {
    snapshotId: stamp.snapshotId,
    previousSnapshotId: 'snap-df4dca5099',
    previousSnapshotStatus: 'HISTORICAL / SUPERSEDED FOR DELIVERY',
    scope: stamp.scope,
    syncedAt: stamp.snapshotFetchedAt,
    sourceRecordUpdatedAt: stamp.sourceRecordUpdatedAt,
    generatedAt: asOf,
    applicationCodeCommit: 'b6c48b041cf2198446d231b59e668597c5060f92',
    rendererCommit: 'b6c48b041cf2198446d231b59e668597c5060f92',
    productionMode: repository.mode === 'production',
    demoFallback: false,
    rowLevelComparisonWithOldSnapshot: 'NOT VERIFIED（旧snapshot生データは永続化されておらず検証不能）',
    note: '件数およびSource実更新日時は旧観測値と一致した。旧snapshotとのrow-level完全一致は検証不能。',
    sources: {
      customers: canonicalize(dataset.customers as unknown as Array<Record<string, unknown>>, 'customerId'),
      projects: canonicalize(dataset.projects as unknown as Array<Record<string, unknown>>, 'projectId')
    },
    specValidation: { forbiddenHits: hits, missingRequired: missing },
    files: [
      { path: pptxPath, sha256: sha256(readFileSync(pptxPath)) },
      { path: xlsxPath, sha256: sha256(readFileSync(xlsxPath)) },
      { path: pdfPath, sha256: sha256(readFileSync(pdfPath)) }
    ]
  };
  const dir = process.env.LCC_ARTIFACT_DIR ?? './data/artifacts';
  mkdirSync(dir, { recursive: true });
  const evidencePath = `${dir}/SNAPSHOT_EVIDENCE_${stamp.snapshotId}.json`;
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`[delivery-artifacts] evidence=${evidencePath}`);

  if (hits.length > 0 || missing.length > 0) {
    console.error(`[delivery-artifacts] Semantic検査FAIL 禁止=${hits.join('/')} 欠落=${missing.join('/')}`);
    process.exitCode = 3;
    return;
  }
  console.log('[delivery-artifacts] Spec禁止/必須表現チェック: PASS');
  console.log('[delivery-artifacts] 完了');
}

main().catch((error) => {
  console.error('[delivery-artifacts] 失敗:', error);
  process.exitCode = 1;
});
