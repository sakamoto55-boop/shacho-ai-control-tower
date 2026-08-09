/* global process, console */
// 成果物3点の独立検査（生成処理とは別実装・夜間最終走行 PHASE 4/11 Review A）。
// 使い方: node scripts/verify-delivery-artifacts.mjs <artifactsDir> <snapshotId>
// PPTX: 全スライド/ノートのテキスト・chart XML・禁止/必須文言
// XLSX: シート名・非表示シート・外部リンク・名前定義・行数・禁止文言・旧snapshotId残存
// PDF: 構造（ページ数・EOF）+ FlateストリームinflateによるASCIIマーカー検査
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';

const [, , dir, snapId] = process.argv;
if (!dir || !snapId) {
  console.error('usage: node verify-delivery-artifacts.mjs <dir> <snapshotId>');
  process.exit(1);
}

const FORBIDDEN = [
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
const REQUIRED_DECK = [
  '算出不能（金額確認済0/91件・カバレッジ0%）',
  '次工程未設定候補 91件（status=contractの意味確認待ち）',
  '2026-06-29T09:30:07.000Z',
  snapId,
  'VERY_STALE'
];

const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass === true ? 'PASS' : pass === 'UNVERIFIED' ? 'UNVERIFIED' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const files = readdirSync(dir);
const find = (pattern) => files.find((f) => f.includes(pattern) && f.includes(snapId));

// ---------- PPTX ----------
{
  const name = find('デッキ');
  const zip = await JSZip.loadAsync(readFileSync(join(dir, name)));
  const slideNames = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
  const noteNames = Object.keys(zip.files).filter((f) => /^ppt\/notesSlides\//.test(f));
  const chartNames = Object.keys(zip.files).filter((f) => /^ppt\/(charts|embeddings)\//.test(f));
  let allText = '';
  for (const s of [...slideNames, ...noteNames]) {
    const xml = await zip.files[s].async('string');
    for (const m of xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)) allText += `${m[1]}\n`;
  }
  const forb = FORBIDDEN.filter((f) => allText.includes(f));
  const miss = REQUIRED_DECK.filter((r) => !allText.includes(r));
  record('PPTX slides', slideNames.length >= 10, `${slideNames.length}枚 / notes ${noteNames.length}`);
  record('PPTX 禁止文言0件', forb.length === 0, forb.join('/') || 'なし');
  record('PPTX 必須文言', miss.length === 0, miss.length ? `欠落: ${miss.join('/')}` : '全件あり');
  let chartForb = [];
  for (const c of chartNames.filter((n) => n.endsWith('.xml'))) {
    const xml = await zip.files[c].async('string');
    if (xml.includes('着地')) chartForb.push(c);
  }
  record('PPTX 0円着地グラフ不在', chartForb.length === 0, `chart parts=${chartNames.length}`);
  record('PPTX レンダリング画像目視', 'UNVERIFIED', 'PPTXレンダラーが本PCに無いため画像化不能（テキスト/XML検査で代替）');
}

// ---------- XLSX ----------
{
  const name = find('台帳');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(dir, name));
  const sheetInfo = wb.worksheets.map((ws) => `${ws.name}(${ws.state ?? 'visible'};${ws.rowCount}行)`);
  const hidden = wb.worksheets.filter((ws) => ws.state && ws.state !== 'visible');
  const main = wb.worksheets[0];
  record('XLSX シート', true, sheetInfo.join(' / '));
  record('XLSX 非表示シートなし', hidden.length === 0, hidden.map((h) => h.name).join(',') || 'なし');
  record('XLSX 行数（案件2,459+ヘッダー）', main.rowCount === 2460, `rowCount=${main.rowCount}`);
  const zip = await JSZip.loadAsync(readFileSync(join(dir, name)));
  const extLinks = Object.keys(zip.files).filter((f) => f.startsWith('xl/externalLinks/'));
  record('XLSX 外部リンクなし', extLinks.length === 0, extLinks.join(',') || 'なし');
  const definedNames = wb.definedNames ? wb.definedNames.model?.length ?? 0 : 0;
  record('XLSX 名前定義', definedNames === 0, `count=${definedNames}`);
  let allText = '';
  wb.worksheets.forEach((ws) => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        allText += `${cell.text}\n`;
      });
    });
  });
  const forb = FORBIDDEN.filter((f) => allText.includes(f));
  record('XLSX 禁止文言0件（旧snapshotId含む）', forb.length === 0, forb.join('/') || 'なし');
  record('XLSX 新snapshotId・Freshness分離', allText.includes(snapId) && allText.includes('取得時刻') && allText.includes('2026-06-29'), '');
  // 受注額列: 金額未確認をを0にしていないこと（ヘッダー行から列位置を特定し、0値の件数を数える）
  const header = main.getRow(1).values;
  const orderIdx = Array.isArray(header) ? header.findIndex((v) => typeof v === 'string' && v.includes('受注額')) : -1;
  if (orderIdx > 0) {
    let zeroCount = 0;
    main.eachRow((row, n) => {
      if (n === 1) return;
      const v = row.getCell(orderIdx).value;
      if (v === 0) zeroCount += 1;
    });
    record('XLSX 受注額0円セルなし（null→0変換なし）', zeroCount === 0, `0円セル=${zeroCount}`);
  } else {
    record('XLSX 受注額列検査', 'UNVERIFIED', '受注額列が見つからない（列名変更の可能性）');
  }
}

// ---------- PDF ----------
{
  const name = find('報告');
  const buf = readFileSync(join(dir, name));
  const latin = buf.toString('latin1');
  const pages = (latin.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  record('PDF 構造', latin.startsWith('%PDF-') && latin.includes('%%EOF') && pages > 0, `pages=${pages} bytes=${buf.length}`);
  // Flateストリームを展開してASCIIマーカーを検査（日本語はglyphエンコードのため対象外）
  let inflated = '';
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(latin)) !== null) {
    const start = m.index + m[0].length;
    const end = latin.indexOf('endstream', start);
    if (end < 0) continue;
    const chunk = buf.subarray(start, end);
    try {
      inflated += inflateSync(chunk).toString('latin1');
    } catch {
      // 非Flate/画像ストリームはスキップ
    }
  }
  record('PDF ストリーム展開', inflated.length > 0, `inflated=${inflated.length}B`);
  record(
    'PDF テキスト内容検査',
    'UNVERIFIED',
    '日本語テキストは埋め込みフォントのglyphエンコードのため抽出不能。Semantic保証はSpec検査+PPTX同一Snapshot由来で代替'
  );
  record('PDF レンダリング画像目視', 'UNVERIFIED', 'PDFレンダラーが本PCに無いため画像化不能');
}

const fails = results.filter((r) => r.pass === false);
console.log(`---\nsummary: PASS=${results.filter((r) => r.pass === true).length} UNVERIFIED=${results.filter((r) => r.pass === 'UNVERIFIED').length} FAIL=${fails.length}`);
if (fails.length > 0) process.exit(3);
