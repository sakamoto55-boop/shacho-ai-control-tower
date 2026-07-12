import { describe, it, expect } from 'vitest'
import { isAllRealData, type ProviderStatusMap } from './morningBriefingEngine'

describe('デモ/実データ表示判定（isAllRealData）', () => {
  const base: ProviderStatusMap = { inbox: 'api', schedule: 'cache', file: 'api', business: 'api', notification: 'api' }

  it('全Providerが api/cache のとき実データ扱い', () => {
    expect(isAllRealData(base)).toBe(true)
  })

  it('1つでもデモ/未設定/取得失敗/取得中があれば実データ扱いにしない', () => {
    expect(isAllRealData({ ...base, notification: 'mock' })).toBe(false)
    expect(isAllRealData({ ...base, business: 'unconfigured' })).toBe(false)
    expect(isAllRealData({ ...base, schedule: 'error' })).toBe(false)
    expect(isAllRealData({ ...base, inbox: 'loading' })).toBe(false)
  })
})
