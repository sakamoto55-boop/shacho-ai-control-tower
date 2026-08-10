/* global process, console */
// 受入チェックリスト.xlsx へ是正⑦（LLM/Memory）の開発側確認行を追加する。
// 社長確認(OK/NG)列（F列）は絶対に書き換えない（全行空欄のまま）。
// 使い方: node scripts/update-checklist-llm.mjs <入力xlsx> <出力xlsx>
import ExcelJS from 'exceljs';

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: node update-checklist-llm.mjs <in> <out>');
  process.exit(1);
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(inPath);
const ws = wb.worksheets[0];

let finalRow = 0;
ws.eachRow((row, rowNumber) => {
  if (String(row.getCell(2).value ?? '') === '総合判定') finalRow = rowNumber;
});

const newRows = [
  ['', '是正⑦: Provider状態', '/command/providers を見る', 'Anthropic=ACTIVE（実API疎通200）・キー存在だけでACTIVE表示しない・キー情報の露出なし', 'PASS（2026-08-10実機。無効キー時はAUTH_FAILED表示も確認）', '', '社長確認欄は空欄のまま'],
  ['', '是正⑦: 一般相談AI', '「一般論として、部門長会議を30分以内に…」を送る', '実Anthropic回答・general_reasoning・質問文エコーバックなし・社内事実の捏造なし', 'PASS（2026-08-10実機）', '', ''],
  ['', '是正⑦: production正直Fallback', 'Provider障害時の応答を見る（開発側は無効キー注入で確認済み）', '「現在、相談AIへ接続できません。Memory検索と社内データ検索は利用できますが…」。mock回答・エコーバック・架空回答なし', 'PASS（合成無効キーでAUTH_FAILED+正直応答を実機確認）', '', ''],
  ['', '是正⑦: Memory想起', '「私が希望している回答の順番を教えて」を送る', 'memory_search使用・保存済み内容（結論→根拠→次の一手）とEvidence表示', 'PASS（再起動後も同一Memory ID mem-2026-08-09-0）', '', ''],
  ['', '是正⑦: Memory保存先', 'data保存先を確認', '%LOCALAPPDATA%\\LCC_COMMAND\\data\\lcc-command-local.json（OneDrive外）。旧ファイルはSHA-256一致コピー後も保持', 'PASS', '', ''],
  ['', '是正⑦: 自動Curation', '「私は、曖昧に賛成されるより…」を覚えてと言わずに送る', 'PREFERENCE候補が自動生成（UNVERIFIED・AUTO・秘密情報なし）', 'PASS（実LLMで mem-2026-08-10-0 生成）', '', '']
];
if (finalRow > 0) {
  ws.spliceRows(finalRow, 0, ...newRows);
} else {
  for (const r of newRows) ws.addRow(r);
}

await wb.xlsx.writeFile(outPath);
console.log(`added=${newRows.length} out=${outPath}`);
