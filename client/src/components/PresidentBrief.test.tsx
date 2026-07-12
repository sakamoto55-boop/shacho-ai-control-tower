// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

// Provider ローダーをモック: inbox は失敗、他は成功 → 他カードが表示され続けることを検証
vi.mock('../core/ai-engine/aiOrchestrator', async (importActual) => {
  const actual = await importActual<typeof import('../core/ai-engine/aiOrchestrator')>()
  return {
    ...actual,
    loadInboxItems: () => Promise.reject(new Error('inbox失敗')),
    loadScheduleItems: () => Promise.resolve({ items: [], source: 'mock' as const }),
    loadMetricItems: () => Promise.resolve({ items: [], source: 'mock' as const }),
  }
})
vi.mock('../core/president/projectLedgerClient', () => ({
  projectLedgerClient: { fetchProjects: () => Promise.resolve({ source: 'unconfigured' as const, projects: [] }) },
}))
vi.mock('../services/sheets/sheetsClient', () => ({
  sheetsClient: { fetchDataset: () => Promise.resolve({ dataset: { projectProfits: [] }, source: 'mock' as const }) },
}))

import PresidentBrief from './PresidentBrief'

describe('PresidentBrief（Provider失敗時の耐性）', () => {
  beforeEach(() => { localStorage.clear() })

  it('inbox取得が失敗しても他のカードとヘッダーが表示される', async () => {
    render(<PresidentBrief onNavigate={() => {}} />)
    // ヘッダー
    expect(screen.getByText(/AI社長室/)).toBeInTheDocument()
    // 他カードのタイトルは表示され続ける
    expect(screen.getByText(/今日の予定/)).toBeInTheDocument()
    expect(screen.getByText(/進行中プロジェクト/)).toBeInTheDocument()
    expect(screen.getByText(/AIの今日の優先順位/)).toBeInTheDocument()
    // 案件台帳未設定の文言（設定エラーで画面が止まらない）
    await waitFor(() => expect(screen.getByText(/案件台帳未設定/)).toBeInTheDocument())
  })
})
