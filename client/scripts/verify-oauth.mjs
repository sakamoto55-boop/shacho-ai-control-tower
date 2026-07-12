// 本番OAuthビルドの検証: 設定画面の「Googleアカウントで接続」を押し、
// 遷移先 accounts.google.com のURLから client_id / redirect_uri / scope を取り出して検証する。
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '../../docs/release-check/ai-president-office-mvp/screenshots')
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const SERVE_ROOT = process.env.SERVE_ROOT
const PORT = 8100
const URL = `http://localhost:${PORT}/shacho-ai-control-tower/`

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
    await page.goto(URL, { waitUntil: 'networkidle' })

    // 未接続デモ確認
    const demoOk = (await page.locator('body').innerText()).includes('AI社長室')
    console.log('DEMO_RENDER=' + demoOk)

    // 設定へ（歯車）
    await page.locator('button:has-text("⚙️")').first().click().catch(() => {})
    await page.waitForTimeout(1200)
    // 接続ボタンの存在
    const btn = page.locator('button:has-text("Googleアカウントで接続")')
    console.log('CONNECT_BTN=' + (await btn.count()))
    await page.screenshot({ path: `${OUT}/deploy_05_settings_oauth_btn.png`, fullPage: true })

    // accounts.google.com への遷移リクエストを横取りして中止（URLだけ取得）
    let authUrl = null
    await page.route('**accounts.google.com/**', (route) => {
      authUrl = route.request().url()
      route.abort()
    })
    page.on('request', (req) => { if (req.url().includes('accounts.google.com')) authUrl = req.url() })

    await btn.first().click().catch(() => {})
    await page.waitForTimeout(2000)
    console.log('AUTH_URL=' + authUrl)

    if (authUrl && authUrl.includes('accounts.google.com')) {
      const u = new URL(authUrl)
      console.log('PARAM_client_id=' + u.searchParams.get('client_id'))
      console.log('PARAM_redirect_uri=' + u.searchParams.get('redirect_uri'))
      console.log('PARAM_scope=' + u.searchParams.get('scope'))
      console.log('HAS_secret_param=' + (authUrl.includes('client_secret') ? 'YES' : 'NO'))
    }
    await ctx.close()
    console.log('done')
  } finally {
    await browser.close()
    server.kill('SIGTERM')
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
