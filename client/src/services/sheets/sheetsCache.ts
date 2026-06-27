// Sheets データのローカルキャッシュ（5分 TTL）
import type { UnifiedBusinessDataset } from '../../core/providers/providerTypes'

const CACHE_KEY = 'sheets_data_cache'
const CACHE_AT_KEY = 'sheets_cache_at'
const TTL_MS = 5 * 60 * 1000

export const sheetsCache = {
  get(): UnifiedBusinessDataset | null {
    try {
      const raw = localStorage.getItem(CACHE_KEY)
      const at = localStorage.getItem(CACHE_AT_KEY)
      if (!raw || !at) return null
      if (Date.now() - parseInt(at, 10) > TTL_MS) return null
      return JSON.parse(raw) as UnifiedBusinessDataset
    } catch {
      return null
    }
  },

  set(dataset: UnifiedBusinessDataset): void {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(dataset))
      localStorage.setItem(CACHE_AT_KEY, Date.now().toString())
    } catch {
      // ignore
    }
  },

  clear(): void {
    localStorage.removeItem(CACHE_KEY)
    localStorage.removeItem(CACHE_AT_KEY)
  },

  isStale(): boolean {
    const at = localStorage.getItem(CACHE_AT_KEY)
    if (!at) return true
    return Date.now() - parseInt(at, 10) > TTL_MS
  },

  getLastFetchedAt(): string | null {
    const at = localStorage.getItem(CACHE_AT_KEY)
    if (!at) return null
    return new Date(parseInt(at, 10)).toISOString()
  },
}
