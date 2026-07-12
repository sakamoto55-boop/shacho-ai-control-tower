// デプロイ検証: gh-pagesと同一バイトの成果物をsubpathでローカル配信し、
// トップ/設定/再読み込み(=404にならない)を撮影する。
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '../../docs/release-check/ai-president-office-mvp/screenshots')
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const SERVE_ROOT = process.env.SERVE_ROOT
const PORT = 8099
const URL = `http://localhost:${PORT}/shacho-ai-control-tower/`
const IPHONE = { width: 393, height: 852 }
const PC = { width: 1280, height: 900 }

function startServer() {
  const p = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: SERVE_ROOT, stdio: 'ignore' })
  return new Promise((res) => setTimeout(() => res(p), 1500))
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const server = await startServer()
  const browser = await chromium.launch({ executablePath: CHROME })
  try {
    // トップ（iPhone）
    let ctx = await browser.newContext({ viewport: IPHONE })
    let page = await ctx.newPage()
    await page.goto(URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${OUT}/deploy_01_top_iphone.png`, fullPage: true })
    // 再読み込み（404にならないこと）
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    const bodyText = await page.locator('body').innerText()
    console.log('RELOAD_OK=' + bodyText.includes('AI社長室'))
    await page.screenshot({ path: `${OUT}/deploy_03_reload.png`, fullPage: true })
    await ctx.close()

    // 設定（歯車）
    ctx = await browser.newContext({ viewport: IPHONE })
    page = await ctx.newPage()
    await page.goto(URL, { waitUntil: 'networkidle' })
    await page.locator('button:has-text("⚙️")').first().click().catch(() => {})
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${OUT}/deploy_04_settings.png`, fullPage: true })
    await ctx.close()

    // トップ（PC）
    ctx = await browser.newContext({ viewport: PC })
    page = await ctx.newPage()
    await page.goto(URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    await page.screenshot({ path: `${OUT}/deploy_02_top_pc.png`, fullPage: true })
    await ctx.close()

    console.log('done')
  } finally {
    await browser.close()
    server.kill('SIGTERM')
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
