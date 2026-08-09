/* global process, console */
// 受入チェックリスト.xlsx を夜間最終走行反映版へ更新する（delivery資材）。
// 使い方: node scripts/update-acceptance-checklist.mjs <入力xlsx> <出力xlsx> <snapshotId> <syncedAt>
// 社長確認(OK/NG)列（F列）は絶対に書き換えない（全行空欄のまま）。
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
  ['起動', { dev: 'PASS（開発側クリーン展開で1回目・2回目ともPASS。health HTTP 200・server.err.log 0B・bat正常終了）', memo: '社長確認欄は空欄のまま（社長操作での確認待ち）' }],
  ['停止', { dev: 'PASS（開発側1回目・2回目ともPASS。保存PIDのみ停止・port8787閉塞・pid削除・他nodeプロセス無影響）', memo: '社長確認欄は空欄のまま' }],
  ['PPTX生成', { memo: `夜間最終走行: ${snapId} から再生成・独立スクリプトで禁止/必須文言検査PASS` }],
  ['XLSX生成', { memo: `夜間最終走行: ${snapId} から再生成・2,459行・非表示シート/外部リンク/名前定義なし` }],
  ['PDF生成', { memo: `夜間最終走行: ${snapId} から再生成・3ページ構造正常` }],
  ['単一Snapshot', { expect: `同一ID（例: ${snapId}）`, memo: '3点とも同一Snapshot Objectから生成（成果物ごとの再取得なし）' }],
  ['意味検証: カバレッジ', { expect: '受注残総額: 算出不能（金額確認済0/91件・カバレッジ0%）。0円非表示・value=null・confidence=UNKNOWN', dev: 'PASS（再生成成果物の機械検査で「算出不能」表記・0円表記なしを確認）' }]
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

let finalRow = 0;
ws.eachRow((row, rowNumber) => {
  if (String(row.getCell(2).value ?? '') === '総合判定') finalRow = rowNumber;
});
const newRows = [
  ['', '開発側: health', 'curl http://localhost:8787/health', 'HTTP 200', 'PASS（クリーン展開スモークで確認）', '', ''],
  ['', '開発側: VUI認証', '/vui?token=<有効トークン> と無効トークン', '有効200・無効/なし401', 'PASS', '', ''],
  ['', '開発側: KPI API認証', '/command/kpi?scope=lcc をAuthorizationヘッダで', '有効200・無効401', 'PASS', '', ''],
  ['', '開発側: production/Demo隔離', '/command/health のmodeと/devエンドポイント', 'mode=production・devは無効・Demo fallbackなし', 'PASS', '', ''],
  ['', '意味検証: PROVISIONAL候補', 'PPTX/KPIの営業対応表示を見る', '「次工程未設定候補 91件（status=contractの意味確認待ち）」・MEDIUM・WATCH。確定営業要対応/HIGH表記なし', 'PASS（再生成PPTX全スライドテキストで機械確認）', '', ''],
  ['', '意味検証: Freshness分離', '成果物のSnapshot欄を見る', `dataUpdated=2026-06-29T09:30:07Z（Source実更新）とsyncedAt=${syncedAt}（取得時刻）が別項目・VERY_STALE明示・出所欄は「取得」表記（取得時刻を更新と表示しない）`, 'PASS（PPTX/XLSXの実テキストで機械確認）', '', '']
];
if (finalRow > 0) {
  ws.spliceRows(finalRow, 0, ...newRows);
} else {
  for (const r of newRows) ws.addRow(r);
}

await wb.xlsx.writeFile(outPath);
console.log(`updated=${updated} added=${newRows.length} out=${outPath}`);
