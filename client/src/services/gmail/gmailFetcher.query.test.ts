import { describe, it, expect } from 'vitest'
import { GMAIL_DEFAULT_QUERY } from './gmailFetcher'

describe('Gmail 既定クエリ（過去72時間）', () => {
  it('newer_than:3d（72時間）を対象にする', () => {
    expect(GMAIL_DEFAULT_QUERY).toContain('newer_than:3d')
  })
  it('受信トレイを対象にする', () => {
    expect(GMAIL_DEFAULT_QUERY).toContain('in:inbox')
  })
})
