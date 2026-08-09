/* global process, console */
// 正式配布ZIPを標準形式で作成する（是正⑥ TRACK A）。
// - パス区切りは必ず '/'。非ASCII名はUTF-8（general purpose bit 11）。
// - ZIP自身のSHA-256はZIP内へ入れない（外部sidecar .zip.sha256 が正）。
// - 作成後に central directory を生検査（エントリ数・bit11・バックスラッシュ0件・整合性）。
// 使い方: node scripts/build-delivery-zip.mjs <stagingDir> <outZipPath>
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';

const [, , stagingDir, outZip] = process.argv;
if (!stagingDir || !outZip) {
  console.error('usage: node build-delivery-zip.mjs <stagingDir> <outZip>');
  process.exit(1);
}

const zip = new JSZip();
let fileCount = 0;
const walk = (dir, rel) => {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const entry = rel ? `${rel}/${name}` : name;
    const st = statSync(abs);
    if (st.isDirectory()) {
      walk(abs, entry);
    } else {
      zip.file(entry, readFileSync(abs), { date: st.mtime, binary: true });
      fileCount += 1;
    }
  }
};
walk(stagingDir, '');

const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
writeFileSync(outZip, buf);
console.log(`[zip] files=${fileCount} bytes=${buf.length} out=${outZip}`);

// --- central directory 生検査 ---
const data = readFileSync(outZip);
let entries = 0;
let nonAscii = 0;
let nonAsciiFlagged = 0;
let backslash = 0;
let absolutePaths = 0;
let traversal = 0;
let emptyNames = 0;
const seenNames = new Set();
let duplicates = 0;
for (let i = 0; i + 4 <= data.length; i++) {
  if (data.readUInt32LE(i) === 0x02014b50) {
    entries += 1;
    const flags = data.readUInt16LE(i + 8);
    const nameLen = data.readUInt16LE(i + 28);
    const nameBytes = data.subarray(i + 46, i + 46 + nameLen);
    const isAscii = nameBytes.every((b) => b < 0x80);
    const name = nameBytes.toString('utf8');
    if (name.includes('\\')) backslash += 1;
    if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) absolutePaths += 1;
    if (name.split('/').includes('..')) traversal += 1;
    if (name.trim() === '') emptyNames += 1;
    if (seenNames.has(name)) duplicates += 1;
    seenNames.add(name);
    if (!isAscii) {
      nonAscii += 1;
      if (flags & 0x0800) nonAsciiFlagged += 1;
    }
    i += 45 + nameLen;
  }
}
// 整合性: 全エントリ展開テスト
const reload = await JSZip.loadAsync(data);
let integrityOk = true;
for (const [, f] of Object.entries(reload.files)) {
  if (f.dir) continue;
  try {
    await f.async('nodebuffer');
  } catch {
    integrityOk = false;
  }
}

const sha = createHash('sha256').update(data).digest('hex');
console.log(
  `[verify] entries=${entries} nonAscii=${nonAscii} nonAsciiWithUtf8Flag=${nonAsciiFlagged} backslashEntries=${backslash} absolute=${absolutePaths} traversal=${traversal} empty=${emptyNames} duplicates=${duplicates} integrity=${integrityOk ? 'PASS' : 'FAIL'}`
);
console.log(`[sha256] ${sha}`);
if (backslash > 0 || nonAscii !== nonAsciiFlagged || absolutePaths > 0 || traversal > 0 || emptyNames > 0 || duplicates > 0 || !integrityOk) {
  console.error('[verify] FAILED');
  process.exit(3);
}
