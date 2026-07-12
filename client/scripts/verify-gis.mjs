// GISフロー検証: 接続ボタンが gsi/client を読み込む（=トークンモデル）ことと、
// 読み込み失敗時にエラーが画面表示される（握り潰さない）ことを確認する。
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '../../docs/release-check/ai-president-office-mvp/screenshots')
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const SERVE_ROOT = process.env.SERVE_ROOT
const PORT = 8101
const APP = `http://localhost:${PORT}/shacho-ai-control-tower/`

function startServer() {
  const p = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: SERVE_ROOT, stdio: 'ignore' })
  return new Promise((res) => setTimeout(() => res(p), 1500))
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const server = await startServer()
  const browser = await chromium.launch({ executablePath: CHROME })
  try {
    const ctx = await browser.newContext({ viewport: { width: 393, height: 852 } })
    const page = await ctx.newPage()

    let gisRequested = false
    let oauthCodeRedirect = false
    page.on('request', (req) => {
      const u = req.url()
      if (u.includes('accounts.google.com/gsi/client')) gisRequested = true
      if (u.includes('accounts.google.com/o/oauth2/v2/auth')) oauthCodeRedirect = true
    })
    // gsi/client はネット遮断で失敗させる（読込失敗→エラー表示の確認）
    await page.route('**accounts.google.com/gsi/client**', (r) => r.abort())

    await page.goto(APP, { waitUntil: 'networkidle' })
    console.log('DEMO_RENDER=' + (await page.locator('body').innerText()).includes('AI社長室'))
    console.log('DEMO_BANNER=' + (await page.locator('body').innerText()).includes('デモデータ表示中'))

    await page.locator('button:has-text("⚙️")').first().click().catch(() => {})
    await page.waitForTimeout(1200)
    await page.locator('button:has-text("Googleアカウントで接続")').first().click().catch(() => {})
    await page.waitForTimeout(2500)

    console.log('GIS_SCRIPT_REQUESTED=' + gisRequested)
    console.log('OLD_CODE_REDIRECT=' + oauthCodeRedirect)
    const body = await page.locator('body').innerText()
    console.log('ERROR_SHOWN=' + (body.includes('読み込みに失敗') || body.includes('失敗') || body.includes('エラー')))
    await page.screenshot({ path: `${OUT}/deploy_06_connect_error.png`, fullPage: true })
    await ctx.close()
    console.log('done')
  } finally {
    await browser.close()
    server.kill('SIGTERM')
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
