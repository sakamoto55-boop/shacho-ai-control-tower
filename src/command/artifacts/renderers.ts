/**
 * Artifact Renderers（Phase LIVE-AI §15-§22）。
 *
 * 実ファイル生成層。内容（Outline・データ）は上流（決定論エンジン + 任意でLLM）が作り、
 * ここは**決定論的なレンダリング**のみを行う（Provider固有にしない・グラフ値をAIに作らせない）。
 * 出力先は data/artifacts/（Git管理外）。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pptxgen from 'pptxgenjs';
// pptxgenjsの型定義はdefault exportがコンストラクタとして解決されないためinterop
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// tsx実行時はCJS interopでdefaultが二重ラップされるため両形状に対応する
const PptxGenJS = (((pptxgen as unknown as { default?: unknown }).default ?? pptxgen) as unknown) as new () => any;
import ExcelJS from 'exceljs';
import {
  AlignmentType,
  Document as DocxDocument,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun
} from 'docx';
import PDFDocument from 'pdfkit';

export const ARTIFACT_DIR = process.env.LCC_ARTIFACT_DIR ?? './data/artifacts';

async function ensureDir(): Promise<string> {
  const dir = resolve(ARTIFACT_DIR);
  await mkdir(dir, { recursive: true });
  return dir;
}

export interface SlideSpec {
  title: string;
  bullets?: string[];
  /** 決定論データのチャート（AIに値を作らせない） */
  chart?: { title: string; labels: string[]; values: number[] };
  note?: string;
}

export interface PresentationSpec {
  title: string;
  subtitle?: string;
  slides: SlideSpec[];
}

/** PPTX生成（§16）。pptxgenjsによる決定論レンダリング */
export async function renderPresentation(spec: PresentationSpec, fileBase: string): Promise<string> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'WIDE', width: 13.33, height: 7.5 });
  pptx.layout = 'WIDE';

  const cover = pptx.addSlide();
  cover.background = { color: '0A1228' };
  cover.addText(spec.title, { x: 0.8, y: 2.6, w: 11.7, h: 1.2, fontSize: 40, bold: true, color: 'FFFFFF' });
  if (spec.subtitle) {
    cover.addText(spec.subtitle, { x: 0.8, y: 3.9, w: 11.7, h: 0.6, fontSize: 18, color: 'A9BBD8' });
  }

  for (const slideSpec of spec.slides) {
    const slide = pptx.addSlide();
    slide.addText(slideSpec.title, { x: 0.6, y: 0.4, w: 12.1, h: 0.8, fontSize: 26, bold: true, color: '0A1228' });
    if (slideSpec.bullets && slideSpec.bullets.length > 0) {
      slide.addText(
        slideSpec.bullets.map((b) => ({ text: b, options: { bullet: true, fontSize: 16, breakLine: true } })),
        { x: 0.8, y: 1.4, w: slideSpec.chart ? 5.8 : 11.7, h: 5.2, valign: 'top' }
      );
    }
    if (slideSpec.chart) {
      slide.addChart('bar', [
        { name: slideSpec.chart.title, labels: slideSpec.chart.labels, values: slideSpec.chart.values }
      ], { x: 6.9, y: 1.4, w: 6.0, h: 5.0, showTitle: true, title: slideSpec.chart.title });
    }
    if (slideSpec.note) {
      slide.addText(slideSpec.note, { x: 0.6, y: 6.8, w: 12.1, h: 0.4, fontSize: 10, color: '67789A' });
    }
  }

  const dir = await ensureDir();
  const path = join(dir, `${fileBase}.pptx`);
  await pptx.writeFile({ fileName: path });
  return path;
}

export interface SheetSpec {
  name: string;
  columns: Array<{ header: string; key: string; width?: number; numFmt?: string }>;
  rows: Array<Record<string, string | number | null | { formula: string }>>;
  /** データ検証（§17） */
  validations?: Array<{ column: string; type: 'list'; options: string[] }>;
}

export interface WorkbookSpec {
  title: string;
  sheets: SheetSpec[];
}

/** XLSX生成（§17）。数式・検証・書式・印刷設定・複数シート対応 */
export async function renderWorkbook(spec: WorkbookSpec, fileBase: string): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'LCC COMMAND';
  for (const sheetSpec of spec.sheets) {
    const sheet = workbook.addWorksheet(sheetSpec.name, {
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
    });
    sheet.columns = sheetSpec.columns.map((c) => ({
      header: c.header,
      key: c.key,
      width: c.width ?? 16,
      style: c.numFmt ? { numFmt: c.numFmt } : {}
    }));
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A2A5E' } };
    for (const row of sheetSpec.rows) sheet.addRow(row);
    for (const validation of sheetSpec.validations ?? []) {
      const colIndex = sheetSpec.columns.findIndex((c) => c.key === validation.column) + 1;
      if (colIndex > 0) {
        for (let r = 2; r <= sheetSpec.rows.length + 1; r += 1) {
          sheet.getCell(r, colIndex).dataValidation = {
            type: 'list',
            allowBlank: true,
            formulae: [`"${validation.options.join(',')}"`]
          };
        }
      }
    }
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  }
  const dir = await ensureDir();
  const path = join(dir, `${fileBase}.xlsx`);
  await workbook.xlsx.writeFile(path);
  return path;
}

export interface DocumentSection {
  heading?: string;
  paragraphs: string[];
}

export interface DocumentSpec {
  title: string;
  sections: DocumentSection[];
  footerNote?: string;
}

/** DOCX生成（§18） */
export async function renderDocument(spec: DocumentSpec, fileBase: string): Promise<string> {
  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: spec.title, bold: true })]
    })
  ];
  for (const section of spec.sections) {
    if (section.heading) {
      children.push(
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(section.heading)] })
      );
    }
    for (const paragraph of section.paragraphs) {
      children.push(new Paragraph({ children: [new TextRun(paragraph)] }));
    }
  }
  if (spec.footerNote) {
    children.push(new Paragraph({ children: [new TextRun({ text: spec.footerNote, size: 16, color: '666666' })] }));
  }
  const doc = new DocxDocument({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);
  const dir = await ensureDir();
  const path = join(dir, `${fileBase}.docx`);
  await writeFile(path, buffer);
  return path;
}

/** PDF生成（§19）。帳票・掲示物・説明資料 */
export async function renderPdf(spec: DocumentSpec, fileBase: string): Promise<string> {
  const dir = await ensureDir();
  const path = join(dir, `${fileBase}.pdf`);
  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  applyJapaneseFont(doc);
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<void>((resolveDone) => doc.on('end', () => resolveDone()));

  doc.fontSize(20).text(spec.title, { align: 'center' });
  doc.moveDown();
  for (const section of spec.sections) {
    if (section.heading) {
      doc.moveDown(0.5).fontSize(14).text(section.heading, { underline: true });
    }
    doc.fontSize(11);
    for (const paragraph of section.paragraphs) doc.text(paragraph);
  }
  if (spec.footerNote) doc.moveDown().fontSize(8).fillColor('#666666').text(spec.footerNote);
  doc.end();
  await done;
  await writeFile(path, Buffer.concat(chunks));
  return path;
}


/** PDFは日本語フォントの埋め込みが必須（標準Helveticaは日本語を描画できない） */
const PDF_FONT_CANDIDATES: Array<[string, string?]> = [
  ...(process.env.LCC_PDF_FONT ? ([[process.env.LCC_PDF_FONT]] as Array<[string]>) : []),
  ['C:\\Windows\\Fonts\\meiryo.ttc', 'Meiryo'],
  ['C:\\Windows\\Fonts\\msgothic.ttc', 'MS-Gothic'],
  ['C:\\Windows\\Fonts\\YuGothM.ttc', 'YuGothic-Medium'],
  ['/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf'],
  ['/System/Library/Fonts/Hiragino Sans GB.ttc', 'HiraginoSansGB-W3']
];

function applyJapaneseFont(doc: InstanceType<typeof PDFDocument>): void {
  for (const [path, family] of PDF_FONT_CANDIDATES) {
    try {
      if (!existsSync(path)) continue;
      if (family) doc.font(path, family);
      else doc.font(path);
      return;
    } catch {
      // 読めないフォントは次候補へ
    }
  }
  // 候補なし: 標準フォント（日本語不可）。OPERATIONS.mdにLCC_PDF_FONT設定手順を記載
}

/** Chart SVG生成（§22）。決定論データのみ。AIに値を作らせない */
export function renderChartSvg(spec: {
  title: string;
  labels: string[];
  values: number[];
  width?: number;
  height?: number;
}): string {
  const width = spec.width ?? 640;
  const height = spec.height ?? 320;
  const pad = 40;
  const max = Math.max(...spec.values.map(Math.abs), 1);
  const barWidth = (width - pad * 2) / Math.max(spec.values.length, 1);
  const bars = spec.values
    .map((value, i) => {
      const barHeight = Math.round((Math.abs(value) / max) * (height - pad * 2 - 24));
      const x = pad + i * barWidth + barWidth * 0.15;
      const y = height - pad - barHeight;
      const label = spec.labels[i] ?? '';
      return [
        `<rect x="${x}" y="${y}" width="${barWidth * 0.7}" height="${barHeight}" fill="${value < 0 ? '#f87171' : '#1d6fe0'}" rx="3"/>`,
        `<text x="${x + barWidth * 0.35}" y="${height - pad + 14}" font-size="10" text-anchor="middle" fill="#333">${label}</text>`
      ].join('');
    })
    .join('');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
    `<text x="${width / 2}" y="22" font-size="14" font-weight="bold" text-anchor="middle" fill="#0a1228">${spec.title}</text>`,
    `<line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" stroke="#999"/>`,
    bars,
    '</svg>'
  ].join('');
}

/** Diagram SVG生成（§21）。業務フロー等の構造図（画像生成と同一視しない） */
export function renderFlowDiagramSvg(spec: { title: string; steps: string[] }): string {
  const boxWidth = 150;
  const boxHeight = 46;
  const gap = 40;
  const width = spec.steps.length * (boxWidth + gap) + gap;
  const height = 140;
  const y = 60;
  const nodes = spec.steps
    .map((step, i) => {
      const x = gap + i * (boxWidth + gap);
      const arrow =
        i < spec.steps.length - 1
          ? `<path d="M ${x + boxWidth} ${y + boxHeight / 2} L ${x + boxWidth + gap - 8} ${y + boxHeight / 2}" stroke="#1d6fe0" stroke-width="2" marker-end="url(#arw)"/>`
          : '';
      return [
        `<rect x="${x}" y="${y}" width="${boxWidth}" height="${boxHeight}" rx="8" fill="#eef4ff" stroke="#1d6fe0"/>`,
        `<text x="${x + boxWidth / 2}" y="${y + boxHeight / 2 + 4}" font-size="11" text-anchor="middle" fill="#0a1228">${step}</text>`,
        arrow
      ].join('');
    })
    .join('');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<defs><marker id="arw" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#1d6fe0"/></marker></defs>',
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
    `<text x="${width / 2}" y="28" font-size="14" font-weight="bold" text-anchor="middle" fill="#0a1228">${spec.title}</text>`,
    nodes,
    '</svg>'
  ].join('');
}

/** SVGをファイルへ保存 */
export async function writeSvg(svg: string, fileBase: string): Promise<string> {
  const dir = await ensureDir();
  const path = join(dir, `${fileBase}.svg`);
  await writeFile(path, svg, 'utf8');
  return path;
}
