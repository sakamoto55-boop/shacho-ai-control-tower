// 案件台帳（進行中プロジェクト）の読み取りクライアント。
// 設定（localStorage）があり、かつGoogle接続済みのときだけ実データを取得する。
// 読み取り専用（GET）。書き込みは一切しない。

import { googleToken } from '../../services/google/googleToken'
import { fetchSheetValues } from '../../services/sheets/sheetsFetcher'
import { loadLedgerConfig, parseLedger, type LedgerProject } from './projectLedger'

export type LedgerSource = 'api' | 'unconfigured' | 'no_auth' | 'config_error' | 'error'

export interface LedgerFetchResult {
  source: LedgerSource
  projects: LedgerProject[]
  error?: string
}

export const projectLedgerClient = {
  async fetchProjects(): Promise<LedgerFetchResult> {
    const cfg = loadLedgerConfig()
    if (!cfg) return { source: 'unconfigured', projects: [] }
    if (!googleToken.hasToken()) return { source: 'no_auth', projects: [] }

    try {
      const accessToken = googleToken.getOrThrow()
      const range = `${cfg.sheetName}!A1:Z1000`
      const values = await fetchSheetValues(accessToken, cfg.spreadsheetId, range)
      const parsed = parseLedger(values.values ?? [], cfg)
      if (!parsed.ok) {
        return { source: 'config_error', projects: [], error: parsed.error }
      }
      return { source: 'api', projects: parsed.projects }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '取得に失敗しました'
      return { source: 'error', projects: [], error: msg }
    }
  },
}
