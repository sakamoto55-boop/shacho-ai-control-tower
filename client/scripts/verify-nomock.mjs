// 接続時に架空データが出ないことを検証する。
// 偽トークンを注入して「接続済み」状態を作り、Home/コックピット/経営/要対応/AI相談で
// mock由来の識別文字列が現れないことを確認。未接続時はデモが出ることも確認。
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '../../docs/release-check/ai-president-office-mvp/screenshots')
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const SERVE_ROOT = process.env.SERVE_ROOT // public/ を root配信
const PORT = 8102
const URL = `http://localhost:${PORT}/`

// 接続時に出てはいけない mock 由来文字列
const FORBIDDEN = [
  '田中 一郎', '佐藤 美咲', '事故報告', // LINE WORKS SOS/事故
  '東京信用金庫 追加資料', '現場確認 — 介護施設C棟', 'お結び運営確認', // 架空予定
]
const FAKE_TOKEN = {
  gauth_access_token: 'FAKE_FOR_VERIFY_ONLY',
  gauth_token_expiry: String(Date.now() + 3600_000),
  gauth_token_scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets.readonly',
  gauth_connected_email: 'verify@example.com',
}

function startServer() {
  const p = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: SERVE_ROOT, stdio: 'ignore' })
  return new Promise((res) => setTimeout(() => res(p), 1200))
}

async function bodyAcrossTabs(page) {
  let text = await page.locator('body').innerText()
  for (const label of ['コックピット', '要対応', '経営', 'AI相談', 'ホーム']) {
    await page.locator(`text=${label}`).last().click().catch(() => {})
    await page.waitForTimeout(900)
    text += '\n' + (await page.locator('body').innerText())
  }
  return text
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const server = await startServer()
  const browser = await chromium.launch({ executablePath: CHROME })
  try {
    // 1) 接続時（偽トークン）: FORBIDDEN が出ないこと
    let ctx = await browser.newContext({ viewport: { width: 393, height: 852 } })
    await ctx.addInitScript((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v) }, FAKE_TOKEN)
    let page = await ctx.newPage()
    await page.goto(URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2500)
    await page.screenshot({ path: `${OUT}/nomock_connected_home.png`, fullPage: true })
    const connectedText = await bodyAcrossTabs(page)
    const leaks = FORBIDDEN.filter((s) => connectedText.includes(s))
    console.log('CONNECTED_LEAKS=' + JSON.stringify(leaks))
    console.log('CONNECTED_HAS_KEIEI_MISETTEI=' + connectedText.includes('経営データ未設定'))
    console.log('CONNECTED_HAS_REALBANNER=' + connectedText.includes('Google接続中'))
    await ctx.close()

    // 2) 未接続（デモ）: mock が出ること（デモが壊れていない）
    ctx = await browser.newContext({ viewport: { width: 393, height: 852 } })
    page = await ctx.newPage()
    await page.goto(URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)
    const demoText = await page.locator('body').innerText()
    console.log('DEMO_SHOWS_MOCK=' + (demoText.includes('東京信用金庫') || demoText.includes('デモデータ表示中')))
    await ctx.close()

    console.log('done')
  } finally {
    await browser.close()
    server.kill('SIGTERM')
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
