// LINE WORKS HTTP薄ラッパー（GET専用）
// 書き込み系APIはすべて WRITE_FORBIDDEN として明示的に禁止する

const LINEWORKS_API_BASE = 'https://www.worksapis.com/v1.0'

function getHeaders(): HeadersInit {
  // 本番時はバックエンドで管理するトークンを使用する
  // フロントエンドにclient_secretを置くことは禁止
  const token = '' // 将来: バックエンドProxy経由
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

export const lineworksFetcher = {
  // ── 読み取り専用メソッド ─────────────────────────────────────

  async getMessages(channelId: string): Promise<unknown> {
    const url = `${LINEWORKS_API_BASE}/channels/${channelId}/messages`
    const res = await fetch(url, { method: 'GET', headers: getHeaders() })
    if (!res.ok) throw new Error(`LINE WORKS API error: ${res.status}`)
    return res.json()
  },

  async getChannels(domainId: string): Promise<unknown> {
    const url = `${LINEWORKS_API_BASE}/domains/${domainId}/channels`
    const res = await fetch(url, { method: 'GET', headers: getHeaders() })
    if (!res.ok) throw new Error(`LINE WORKS API error: ${res.status}`)
    return res.json()
  },

  // ── 書き込み禁止メソッド（WRITE_FORBIDDEN）──────────────────
  // 以下のメソッドは意図的に未実装。呼び出すとエラーになる。

  async sendMessage(): Promise<never> {
    throw new Error('WRITE_FORBIDDEN: sendMessage is not allowed in this implementation')
  },

  async replyMessage(): Promise<never> {
    throw new Error('WRITE_FORBIDDEN: replyMessage is not allowed in this implementation')
  },

  async markAsRead(): Promise<never> {
    throw new Error('WRITE_FORBIDDEN: markAsRead is not allowed in this implementation')
  },

  async deleteMessage(): Promise<never> {
    throw new Error('WRITE_FORBIDDEN: deleteMessage is not allowed in this implementation')
  },

  async postToChannel(): Promise<never> {
    throw new Error('WRITE_FORBIDDEN: postToChannel is not allowed in this implementation')
  },

  async sendBotMessage(): Promise<never> {
    throw new Error('WRITE_FORBIDDEN: sendBotMessage is not allowed in this implementation')
  },

  async addMember(): Promise<never> {
    throw new Error('WRITE_FORBIDDEN: addMember is not allowed in this implementation')
  },

  async sendFile(): Promise<never> {
    throw new Error('WRITE_FORBIDDEN: sendFile is not allowed in this implementation')
  },

  async updateMessage(): Promise<never> {
    throw new Error('WRITE_FORBIDDEN: updateMessage is not allowed in this implementation')
  },

  async createChannel(): Promise<never> {
    throw new Error('WRITE_FORBIDDEN: createChannel is not allowed in this implementation')
  },
}
