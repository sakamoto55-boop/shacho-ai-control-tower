// LINE WORKS 5分TTLキャッシュ（localStorage）

const CACHE_KEY = 'lw_notifications_cache'
const CACHE_AT_KEY = 'lw_cache_at'
const TTL_MS = 5 * 60 * 1000

export const lineworksCache = {
  get<T>(): T | null {
    try {
      const raw = localStorage.getItem(CACHE_KEY)
      const at = localStorage.getItem(CACHE_AT_KEY)
      if (!raw || !at) return null
      if (Date.now() - Number(at) > TTL_MS) return null
      return JSON.parse(raw) as T
    } catch {
      return null
    }
  },

  set<T>(data: T): void {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data))
      localStorage.setItem(CACHE_AT_KEY, String(Date.now()))
    } catch {
      // localStorage unavailable
    }
  },

  clear(): void {
    localStorage.removeItem(CACHE_KEY)
    localStorage.removeItem(CACHE_AT_KEY)
  },

  isStale(): boolean {
    const at = localStorage.getItem(CACHE_AT_KEY)
    if (!at) return true
    return Date.now() - Number(at) > TTL_MS
  },
}
