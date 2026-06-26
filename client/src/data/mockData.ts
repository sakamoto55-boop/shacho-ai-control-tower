import type { ActionItem, ChatMessage, DashboardMetric, CreateTemplate, Connection } from '../types'

// ── 今日の要対応 ──────────────────────────────────────────
export const mockActionItems: ActionItem[] = [
  {
    id: 'a1',
    priority: 'A',
    subject: '工事代金未払い件について至急連絡ください',
    from: '田中建設 田中部長',
    deadline: '本日17時まで',
    action: '電話 or メール返信',
    category: 'メール',
    isRead: false,
  },
  {
    id: 'a2',
    priority: 'A',
    subject: '銀行融資審査書類の追加提出依頼',
    from: '三菱UFJ銀行 佐藤担当',
    deadline: '本日中',
    action: '書類準備・提出',
    category: 'メール',
    isRead: false,
  },
  {
    id: 'a3',
    priority: 'A',
    subject: '現場事故報告 ― 作業員軽傷',
    from: '加藤現場監督',
    deadline: '即日対応',
    action: '状況確認・指示',
    category: 'LINE WORKS',
    isRead: false,
  },
  {
    id: 'b1',
    priority: 'B',
    subject: '外注業者との単価改定交渉 回答依頼',
    from: '株式会社植竹 経理',
    deadline: '今週金曜',
    action: '方針決定・返信',
    category: 'メール',
    isRead: true,
  },
  {
    id: 'b2',
    priority: 'B',
    subject: '新規案件見積もり依頼（戸建てリフォーム）',
    from: '山田様（個人）',
    deadline: '今週中',
    action: '見積作成・送付',
    category: 'メール',
    isRead: true,
  },
  {
    id: 'b3',
    priority: 'B',
    subject: '社員研修日程の最終確認',
    from: '人事 鈴木',
    deadline: '来週月曜まで',
    action: '日程承認',
    category: 'LINE WORKS',
    isRead: true,
  },
  {
    id: 'w1',
    priority: 'waiting-confirm',
    subject: 'freee請求書 #2024-089 入金確認待ち',
    from: '経理 山本',
    deadline: '入金予定 6/28',
    action: '入金確認後クローズ',
    category: '経理',
    isRead: true,
  },
  {
    id: 'w2',
    priority: 'waiting-confirm',
    subject: '外注見積もり回答待ち（水道工事）',
    from: '山田設備',
    deadline: '返答待ち',
    action: '回答次第発注判断',
    category: 'メール',
    isRead: true,
  },
  {
    id: 'wc1',
    priority: 'waiting-create',
    subject: '○○建設向け工事提案書',
    from: '自分',
    deadline: '今週中に作成',
    action: 'AIで資料作成',
    category: '作成',
    isRead: true,
  },
]

// ── チャット初期メッセージ ────────────────────────────────
export const initialChatMessages: ChatMessage[] = [
  {
    id: 'init',
    role: 'assistant',
    content:
      'おはようございます、坂本社長。\n本日は要対応が **3件（優先度A）** あります。\n\n何でもお申し付けください。メール返信文の作成、資料作成、経営情報の確認など、すぐにサポートします。',
    timestamp: new Date(),
  },
]

// ── プロンプト例 ──────────────────────────────────────────
export const promptSuggestions = [
  '昨日の重要メールをまとめて',
  '今日やるべきことを整理して',
  '加藤さんへの返信文を作って',
  '銀行向け資料を作って',
  '現場で止まっている案件を教えて',
  'マヌスへの指示文を作って',
  'freeeの入金状況を確認して',
  '今月の売上を教えて',
]

// ── 経営ダッシュボード ────────────────────────────────────
export const dashboardMetrics: DashboardMetric[] = [
  {
    id: 'm1',
    label: '今月売上',
    value: '¥28,400,000',
    subValue: '前月比 +12%',
    trend: 'up',
  },
  {
    id: 'm2',
    label: '今月粗利',
    value: '¥8,120,000',
    subValue: '粗利率 28.6%',
    trend: 'up',
  },
  {
    id: 'm3',
    label: '入金予定（今月）',
    value: '¥15,600,000',
    subValue: '3件',
    trend: 'neutral',
  },
  {
    id: 'm4',
    label: '支払予定（今月）',
    value: '¥11,200,000',
    subValue: '外注費含む',
    trend: 'neutral',
  },
  {
    id: 'm5',
    label: '資金繰り注意',
    value: '残高 ¥4,200,000',
    subValue: '来月初に要確認',
    alert: true,
    alertLevel: 'warning',
    trend: 'down',
  },
  {
    id: 'm6',
    label: '未請求案件',
    value: '3件',
    subValue: '合計 ¥6,800,000',
    alert: true,
    alertLevel: 'warning',
    trend: 'neutral',
  },
  {
    id: 'm7',
    label: '事故・クレーム',
    value: '1件対応中',
    subValue: '6/25発生・軽傷',
    alert: true,
    alertLevel: 'danger',
    trend: 'neutral',
  },
  {
    id: 'm8',
    label: '人員不足',
    value: '現場2チーム',
    subValue: '来週からの応援手配中',
    alert: true,
    alertLevel: 'warning',
    trend: 'neutral',
  },
]

// ── 作成メニュー ──────────────────────────────────────────
export const createTemplates: CreateTemplate[] = [
  {
    id: 'c1',
    label: '社内連絡文',
    icon: '📝',
    description: '社員向けの通知・連絡文',
    category: '社内',
  },
  {
    id: 'c2',
    label: '返信文',
    icon: '↩️',
    description: 'メール・LINE WORKSへの返信',
    category: '対外',
  },
  {
    id: 'c3',
    label: '銀行資料',
    icon: '🏦',
    description: '融資・審査用の説明資料',
    category: '対外',
  },
  {
    id: 'c4',
    label: '契約書たたき台',
    icon: '📄',
    description: '契約書の初期ドラフト作成',
    category: '対外',
  },
  {
    id: 'c5',
    label: 'プレゼン構成',
    icon: '📊',
    description: '提案・報告用スライド構成',
    category: '対外',
  },
  {
    id: 'c6',
    label: '議事録',
    icon: '🗒️',
    description: '会議・打合せの議事録',
    category: '社内',
  },
  {
    id: 'c7',
    label: 'タスクリスト',
    icon: '✅',
    description: 'プロジェクト別タスク整理',
    category: '社内',
  },
  {
    id: 'c8',
    label: 'Manus指示文',
    icon: '🤖',
    description: 'Manusへの作業依頼テキスト',
    category: 'AI指示',
  },
  {
    id: 'c9',
    label: 'Claude Code指示文',
    icon: '💻',
    description: 'Claude Codeへの開発指示',
    category: 'AI指示',
  },
  {
    id: 'c10',
    label: 'Gemini指示文',
    icon: '✨',
    description: 'Geminiへの分析・生成指示',
    category: 'AI指示',
  },
]

// ── 接続設定 ──────────────────────────────────────────────
export const connections: Connection[] = [
  { id: 'gmail', name: 'Gmail', status: 'planned', icon: '📧' },
  { id: 'gcal', name: 'Googleカレンダー', status: 'planned', icon: '📅' },
  { id: 'gdrive', name: 'Google Drive', status: 'planned', icon: '📁' },
  { id: 'lineworks', name: 'LINE WORKS', status: 'planned', icon: '💬' },
  { id: 'gsheet', name: 'Googleスプレッドシート', status: 'planned', icon: '📊' },
  { id: 'freee', name: 'freee', status: 'planned', icon: '💹' },
  { id: 'tkc', name: 'TKC', status: 'planned', icon: '🏢' },
]

// ── 会社リスト ────────────────────────────────────────────
export const companies = [
  { id: 'lcc', name: 'LCC株式会社', shortName: 'LCC' },
  { id: 'uetake', name: '株式会社植竹', shortName: '植竹' },
  { id: 'global-bridge', name: 'グローバルブリッジ合同会社', shortName: 'GB' },
  { id: 'mirai', name: '一般社団法人みらい創造公社', shortName: 'みらい' },
]

// ── API連携ポイント（将来） ───────────────────────────────
export const apiIntegrationPoints = [
  {
    feature: 'AI相談チャット',
    endpoint: 'POST /api/chat',
    provider: 'Claude API (claude-opus-4-8)',
    note: 'ストリーミング対応予定',
  },
  {
    feature: '今日の要対応',
    endpoint: 'GET /api/actions',
    provider: 'Gmail API + LINE WORKS API',
    note: '優先度分類はAIで自動付与',
  },
  {
    feature: '経営ダッシュボード',
    endpoint: 'GET /api/dashboard',
    provider: 'freee API + Google Sheets API',
    note: '月次集計、キャッシュ1時間',
  },
  {
    feature: '作成依頼',
    endpoint: 'POST /api/create',
    provider: 'Claude API',
    note: '各テンプレートごとにシステムプロンプト設定',
  },
  {
    feature: '設定保存',
    endpoint: 'PUT /api/settings',
    provider: 'ローカルDB (SQLite)',
    note: 'Phase 1ではlocalStorageで代替',
  },
]
