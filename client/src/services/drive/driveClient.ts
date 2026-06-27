import { googleToken } from '../google/googleToken'
import { mockDriveFiles } from './mockDrive'
import { driveCache } from './driveCache'
import { fetchDriveFiles } from './driveFetcher'
import type { GoogleDriveFile } from './types'

interface FetchResult {
  files: GoogleDriveFile[]
  source: 'mock' | 'cache' | 'api'
}

export const driveClient = {
  async fetchFiles(): Promise<FetchResult> {
    if (!googleToken.hasToken()) {
      return { files: mockDriveFiles, source: 'mock' }
    }
    const cached = driveCache.get()
    if (cached) {
      return { files: cached, source: 'cache' }
    }
    try {
      const accessToken = googleToken.getOrThrow()
      const files = await fetchDriveFiles(accessToken)
      driveCache.set(files)
      return { files, source: 'api' }
    } catch {
      const stale = driveCache.get()
      if (stale) return { files: stale, source: 'cache' }
      return { files: mockDriveFiles, source: 'mock' }
    }
  },

  async refreshFiles(): Promise<FetchResult> {
    driveCache.clear()
    return this.fetchFiles()
  },

  isUsingMock(): boolean {
    return !googleToken.hasToken()
  },
}
