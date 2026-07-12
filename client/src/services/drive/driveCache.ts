import type { GoogleDriveFile } from './types'

const CACHE_KEY = 'drive_file_cache'
const CACHE_AT_KEY = 'drive_cache_at'
const TTL_MS = 5 * 60 * 1000 // 5 minutes

export const driveCache = {
  get(): GoogleDriveFile[] | null {
    if (this.isStale()) return null
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    try {
      return JSON.parse(raw) as GoogleDriveFile[]
    } catch {
      return null
    }
  },

  set(files: GoogleDriveFile[]): void {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(files))
    sessionStorage.setItem(CACHE_AT_KEY, new Date().toISOString())
  },

  clear(): void {
    sessionStorage.removeItem(CACHE_KEY)
    sessionStorage.removeItem(CACHE_AT_KEY)
  },

  isStale(): boolean {
    const at = sessionStorage.getItem(CACHE_AT_KEY)
    if (!at) return true
    return Date.now() - new Date(at).getTime() > TTL_MS
  },

  getLastFetchedAt(): string | null {
    return sessionStorage.getItem(CACHE_AT_KEY)
  },
}
