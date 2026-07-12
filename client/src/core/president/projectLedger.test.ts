import { describe, it, expect } from 'vitest'
import { parseLedger, type LedgerConfig } from './projectLedger'

const cfg: LedgerConfig = {
  spreadsheetId: 'dummy', sheetName: '案件',
  columns: { projectName: '案件名', assignee: '担当', status: '状態', revenue: '売上', cost: '原価', grossProfit: '粗利', deadline: '期限', updatedAt: '更新' },
}

describe('parseLedger（案件台帳・ヘッダー名判定）', () => {
  it('列順が違ってもヘッダー名で正しくマッピングする', () => {
    const values = [
      ['担当', '案件名', '状態', '期限'],
      ['山田', 'A解体工事', '進行中', '2026-07-31'],
      ['佐藤', 'B外構', '見積中', '2026-08-10'],
    ]
    const r = parseLedger(values, cfg)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.projects).toHaveLength(2)
      expect(r.projects[0]).toMatchObject({ projectName: 'A解体工事', assignee: '山田', status: '進行中', deadline: '2026-07-31' })
    }
  })

  it('案件名列が無い場合は設定エラーを返す（画面は止めない）', () => {
    const values = [['担当', '状態'], ['山田', '進行中']]
    const r = parseLedger(values, cfg)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('案件名列')
  })

  it('空行（案件名なし）は除外する', () => {
    const values = [['案件名', '担当'], ['A', '山田'], ['', ''], ['B', '佐藤']]
    const r = parseLedger(values, cfg)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.projects.map((p) => p.projectName)).toEqual(['A', 'B'])
  })

  it('データなしはエラー', () => {
    const r = parseLedger([], cfg)
    expect(r.ok).toBe(false)
  })
})
