/* global process, console */
// 受入チェックリスト.xlsx を是正⑥（パッケージ整合）反映版へ更新する（TRACK A delivery資材）。
// 使い方: node scripts/update-acceptance-checklist.mjs <入力xlsx> <出力xlsx> <snapshotId> <syncedAt(日付)>
// 社長確認(OK/NG)列（F列）は絶対に書き換えない。
import ExcelJS from 'exceljs';

const [, , inPath, outPath, snapId, syncedAt] = process.argv;
if (!inPath || !outPath || !snapId || !syncedAt) {
  console.error('usage: node update-acceptance-checklist.mjs <in> <out> <snapshotId> <syncedAt>');
  process.exit(1);
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(inPath);
const ws = wb.worksheets[0];

const updates = new Map([
  ['起動', { dev: `✅ 開発側クリーン展開でPASS（是正⑤: 起動×2回・health200・err.log 0B）`, memo: '社長確認欄は空欄のまま（社長操作での確認待ち）' }],
  ['停止', { dev: '✅ 開発側2回PASS（保存PIDのみ停止・port8787閉塞確認・pid削除）', memo: '社長確認欄は空欄のまま' }],
  ['PPTX生成', { memo: `是正⑥: ${snapId} から再生成・禁止表現機械検査PASS` }],
  ['XLSX生成', { memo: `是正⑥: ${snapId} から再生成・2,459行・Freshness分離確認` }],
  ['PDF生成', { memo: `是正⑥: ${snapId} から再生成` }],
  ['単一Snapshot', { expect: `同一ID（例: ${snapId}）`, memo: '是正⑥再生成分で3点一致を確認' }],
  ['意味検証: カバレッジ', { expect: '受注残総額: 算出不能（金額確認済0/91件・カバレッジ0%）。0円非表示・value=null・confidence=UNKNOWN', dev: '✅ 是正⑥再生成成果物の機械検査で「算出不能」表記を確認（0円表記なし）' }]
]);

let updated = 0;
ws.eachRow((row, rowNumber) => {
  if (rowNumber === 1) return;
  const item = String(row.getCell(2).value ?? '');
  const u = updates.get(item);
  if (!u) return;
  if (u.expect) row.getCell(4).value = u.expect;
  if (u.dev) row.getCell(5).value = u.dev;
  if (u.memo) row.getCell(7).value = u.memo;
  updated += 1;
});

// 新規行（総合判定の直前へ挿入）: PROVISIONAL候補・Freshness分離
let finalRow = 0;
ws.eachRow((row, rowNumber) => {
  if (String(row.getCell(2).value ?? '') === '総合判定') finalRow = rowNumber;
});
const newRows = [
  ['', '意味検証: PROVISIONAL候補', 'PPTX/KPIの営業対応表示を見る', '「次工程未設定候補 91件（status=contractの意味確認待ち）」表示・確定した営業要対応と表現しない（MEDIUM/WATCH扱い）', '✅ 是正⑥再生成PPTXのスライド文言で機械確認', '', ''],
  ['', '意味検証: Freshness分離', '成果物のSnapshot欄を見る', `sourceRecordUpdatedAt=2026-06-29T09:30:07Z（データ実更新）と snapshotFetchedAt=${syncedAt}（取得時刻）が別項目で表示される（データ鮮度はVERY_STALE相当=41日超）`, '✅ XLSXメタデータ・PPTX出所スライドで機械確認', '', '']
];
if (finalRow > 0) {
  ws.spliceRows(finalRow, 0, ...newRows);
} else {
  for (const r of newRows) ws.addRow(r);
}

await wb.xlsx.writeFile(outPath);
console.log(`updated=${updated} added=${newRows.length} out=${outPath}`);
