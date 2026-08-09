import 'dotenv/config';
/**
 * 正式配布パッケージ用の成果物3点（PPTX/XLSX/PDF）を単一Snapshotから生成する（是正⑥ TRACK A）。
 *
 * - Sheets実データを1回だけ取得し、件数（顧客2,268/案件2,459）と
 *   sourceRecordUpdatedAt（2026-06-29T09:30:07.000Z）を検証する。
 *   不一致なら SOURCE STATE CHANGED で停止（exit 2）。
 * - 3成果物は同じ SnapshotStamp（同一Snapshot Object）から生成する。
 * - 出力先は LCC_ARTIFACT_DIR（Git管理外）。SNAPSHOT_EVIDENCE.json を併産する。
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
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

async function main(): Promise<void> {
  const repository = createCommandRepository();
  const asOf = new Date().toISOString();
  const dataset = await repository.getDataset(asOf);
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
    customers !== EXPECTED_CUSTOMERS ||
    projects !== EXPECTED_PROJECTS ||
    stamp.sourceRecordUpdatedAt !== EXPECTED_SOURCE_RECORD_UPDATED_AT
  ) {
    console.error('[delivery-artifacts] SOURCE STATE CHANGED — 期待値と不一致のため停止します。');
    console.error(
      `  expected customers=${EXPECTED_CUSTOMERS} projects=${EXPECTED_PROJECTS} sourceRecordUpdatedAt=${EXPECTED_SOURCE_RECORD_UPDATED_AT}`
    );
    process.exitCode = 2;
    return;
  }

  // 同一Snapshot Object（同じstamp）から3点を構築
  const deckSpec = buildManagementDeckSpec(dataset, scope, stamp);
  const ledgerSpec = buildProjectLedgerWorkbookSpec(dataset, scope, stamp);
  const reportSpec = buildReportDocumentSpec(dataset, scope, stamp);

  const base = (kind: string): string => `${kind}_${stamp.snapshotId}_v4`;
  const pptxPath = await renderPresentation(deckSpec, base('LCC経営会議デッキ'));
  const xlsxPath = await renderWorkbook(ledgerSpec, base('LCC案件台帳'));
  const pdfPath = await renderPdf(reportSpec, base('LCC経営報告'));

  const sha256 = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');
  const evidence = {
    generatedAt: asOf,
    snapshotId: stamp.snapshotId,
    scope: stamp.scope,
    counts: { customers, projects },
    sourceRecordUpdatedAt: stamp.sourceRecordUpdatedAt,
    snapshotFetchedAt: stamp.snapshotFetchedAt,
    freshness: stamp.freshness,
    dataGaps: stamp.dataGaps,
    sources: stamp.sources,
    singleSnapshotObject: true,
    note: 'ソース件数・Source側最終更新は旧snapshot snap-df4dca5099 時点の記録と一致（全行完全一致の主張はしない）',
    files: [
      { path: pptxPath, sha256: sha256(pptxPath) },
      { path: xlsxPath, sha256: sha256(xlsxPath) },
      { path: pdfPath, sha256: sha256(pdfPath) }
    ]
  };
  const evidencePath = `${process.env.LCC_ARTIFACT_DIR ?? './data/artifacts'}/SNAPSHOT_EVIDENCE_${stamp.snapshotId}.json`;
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`[delivery-artifacts] evidence=${evidencePath}`);

  // 機械検査: 禁止表現がSpecに含まれないこと（着地予測0円・受注残0円等）
  const specText = JSON.stringify({ deckSpec, reportSpec });
  const forbidden = ['着地予測（参考値）は0円', '着地予測: 0円', '受注残: 0円', '金額確認済0件（0円）'];
  const hits = forbidden.filter((f) => specText.includes(f));
  if (hits.length > 0) {
    console.error(`[delivery-artifacts] 禁止表現を検出: ${hits.join(' / ')}`);
    process.exitCode = 3;
    return;
  }
  console.log('[delivery-artifacts] 禁止表現チェック: PASS');
  console.log('[delivery-artifacts] 完了');
}

main().catch((error) => {
  console.error('[delivery-artifacts] 失敗:', error);
  process.exitCode = 1;
});
