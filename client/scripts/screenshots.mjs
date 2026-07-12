// AI社長室MVP スクリーンショット取得スクリプト。
// vite preview を起動し、事前インストール済み Chromium で6状態を撮影する。
// 保存先: docs/release-check/ai-president-office-mvp/screenshots/

import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '../../docs/release-check/ai-president-office-mvp/screenshots')
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const BASE = 'http://localhost:4173/'
const IPHONE = { width: 393, height: 852 } // iPhone 15 相当
const PC = { width: 1280, height: 900 }

function startPreview() {
  const p = spawn('npm', ['run', 'preview', '--', '--port', '4173', '--strictPort'], { cwd: resolve(__dirname, '..'), stdio: 'pipe' })
  return new Promise((res) => {
    const onData = (d) => { if (d.toString().includes('4173')) { res(p) } }
    p.stdout.on('data', onData)
    setTimeout(() => res(p), 4000)
  })
}

const FAKE_TOKEN = {
  gauth_access_token: 'FAKE_FOR_SCREENSHOT_ONLY',
  gauth_token_expiry: String(Date.now() + 3600_000),
  gauth_token_scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets.readonly',
  gauth_connected_email: 'demo@example.com',
}
const LEDGER = {
  spreadsheetId: 'SCREENSHOT_DUMMY_ID', sheetName: '案件',
  columns: { projectName: '案件名', assignee: '担当', status: '状態', revenue: '売上', cost: '原価', grossProfit: '粗利', deadline: '期限', updatedAt: '更新' },
}

async function shot(browser, name, viewport, { storage } = {}) {
  const context = await browser.newContext({ viewport })
  if (storage) {
    await context.addInitScript((s) => {
      for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v)
    }, storage)
  }
  const page = await context.newPage()
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })
  await context.close()
  console.log('saved', name)
}

async function shotSettings(browser, name, viewport, storage) {
  const context = await browser.newContext({ viewport })
  if (storage) await context.addInitScript((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v) }, storage)
  const page = await context.newPage()
  await page.goto(BASE, { waitUntil: 'networkidle' })
  // 設定はヘッダー右上の歯車（⚙️）から開く
  await page.locator('button:has-text("⚙️")').first().click().catch(() => {})
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })
  await context.close()
  console.log('saved', name)
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const preview = await startPreview()
  const browser = await chromium.launch({ executablePath: CHROME })
  try {
    await shot(browser, '01_top_iphone', IPHONE)                       // トップ iPhone幅
    await shot(browser, '02_top_pc', PC)                              // トップ PC幅
    await shot(browser, '03_top_demo_identification', IPHONE)          // デモ/実データ識別（デモバッジ）
    await shot(browser, '04_top_ledger_unconfigured', IPHONE)         // 案件台帳未設定
    await shot(browser, '05_top_fetch_error', IPHONE, {               // 取得失敗（偽トークン＋台帳設定で401）
      storage: { ...FAKE_TOKEN, president_project_ledger_config: JSON.stringify(LEDGER) },
    })
    await shotSettings(browser, '06_settings_oauth', IPHONE)           // 設定：Google接続状態
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
