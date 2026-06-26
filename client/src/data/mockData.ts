import type {
  AiModeConfig,
  ActionItem,
  Briefing,
  CashflowWeek,
  ChatMessage,
  Company,
  CreateTemplate,
  DashboardMetric,
  DepartmentMetric,
  Integration,
  ProjectMetric,
  SituationCard,
  ApiIntegrationPoint,
} from '../types'

// ── 会社リスト ─────────────────────────────────────────────
export const companies: Company[] = [
  { id: 'lcc', name: 'LCC株式会社', shortName: 'LCC' },
  { id: 'uetake', name: '株式会社植竹', shortName: '植竹' },
  { id: 'global-bridge', name: 'グローバルブリッジ合同会社', shortName: 'GB' },
  { id: 'mirai', name: '一般社団法人みらい創造公社', shortName: 'みらい' },
]

// ── AIアシスタントモード ────────────────────────────────────
export const aiModes: AiModeConfig[] = [
  {
    id: 'secretary',
    label: 'AI秘書',
    icon: '🗂️',
    color: '#1B3D6F',
    prompts: [
      '今日やるべきことを整理して',
      '昨日からの重要変化を教えて',
      '未対応の連絡を優先順にして',
      '今日の予定を確認して',
      '至急対応が必要な件を教えて',
    ],
  },
  {
    id: 'management',
    label: 'AI経営',
    icon: '📊',
    color: '#7C3AED',
    prompts: [
      '今月の資金繰りリスクを教えて',
      '粗利が悪い案件を教えて',
      '未請求と未回収を整理して',
      '銀行借入状況をまとめて',
      '今月の損益見込みを教えて',
    ],
  },
  {
    id: 'field',
    label: 'AI現場',
    icon: '🏗️',
    color: '#D97706',
    prompts: [
      '今日止まりそうな現場はある？',
      '人員不足の現場を教えて',
      '事故・クレーム状況をまとめて',
      '今週完了予定の現場を教えて',
      '追加工事が発生している案件は？',
    ],
  },
  {
    id: 'admin',
    label: 'AI事務',
    icon: '📋',
    color: '#059669',
    prompts: [
      '返信が必要なメールを整理して',
      '請求漏れがないか見て',
      '作成すべき書類を教えて',
      '未発行の請求書を確認して',
      '期限が近い書類を教えて',
    ],
  },
  {
    id: 'sales',
    label: 'AI営業',
    icon: '🤝',
    color: '#DC2626',
    prompts: [
      '追客すべき案件を教えて',
      '見積提出後の未回答案件を整理して',
      '今日電話すべき相手を教えて',
      '失注リスクの高い案件は？',
      '今月の受注見込みを教えて',
    ],
  },
  {
    id: 'welfare',
    label: 'AI福祉',
    icon: '🌸',
    color: '#DB2777',
    prompts: [
      'お結びの確認事項を整理して',
      '監査・行政対応の未完了を教えて',
      '利用者・職員対応で注意することを教えて',
      '今月の加算算定状況を教えて',
      '処遇改善関連の確認事項は？',
    ],
  },
]

// ── 朝ブリーフィング ───────────────────────────────────────
export const todayBriefing: Briefing = {
  date: '2026年6月26日（金）',
  greeting: 'おはようございます、坂本社長。\n昨日から重要な変化が3件あります。',
  changes: [
    { type: 'danger', icon: '🏦', text: '銀行から追加資料依頼（本日中）' },
    { type: 'warning', icon: '⚠️', text: '現場事故報告 1件（加藤監督より）' },
    { type: 'warning', icon: '💰', text: '未請求案件 3件・合計 ¥6,800,000' },
  ],
  topActions: [
    '銀行資料の準備・本日中に送付',
    '事故現場の状況確認・対応指示',
    '未請求案件の担当確認・請求書作成依頼',
  ],
}

// ── ホーム：状況カード ─────────────────────────────────────
export const situationCards: SituationCard[] = [
  {
    id: 'schedule',
    label: '今日の予定',
    value: '3件',
    sub: '10:00 銀行打合せ',
    icon: '📅',
    screen: 'dashboard',
  },
  {
    id: 'changes',
    label: '昨日からの変化',
    value: '3件',
    sub: '重要変化あり',
    icon: '🔄',
    alert: true,
    alertLevel: 'warning',
    screen: 'actions',
  },
  {
    id: 'notification',
    label: '重要通知',
    value: '2件',
    sub: '銀行・現場',
    icon: '🔔',
    alert: true,
    alertLevel: 'warning',
    screen: 'actions',
  },
  {
    id: 'field',
    label: '今日の現場',
    value: '5現場',
    sub: 'うち1か所注意',
    icon: '🏗️',
    alert: true,
    alertLevel: 'warning',
    screen: 'dashboard',
  },
  {
    id: 'income',
    label: '今日の入金',
    value: '2件',
    sub: '¥3,200,000',
    icon: '💰',
    screen: 'dashboard',
  },
  {
    id: 'expense',
    label: '今日の支払',
    value: '4件',
    sub: '¥1,850,000',
    icon: '💳',
    screen: 'dashboard',
  },
  {
    id: 'sos',
    label: '社員からのSOS',
    value: '1件',
    sub: '現場より緊急連絡',
    icon: '🆘',
    alert: true,
    alertLevel: 'danger',
    screen: 'actions',
  },
  {
    id: 'unbilled',
    label: '未請求アラート',
    value: '3件',
    sub: '¥6,800,000',
    icon: '⚠️',
    alert: true,
    alertLevel: 'warning',
    screen: 'dashboard',
  },
]

// ── 今日の要対応（強化版） ─────────────────────────────────
export const actionItems: ActionItem[] = [
  {
    id: 'a1',
    priority: 'A',
    subject: '工事代金未払い件について至急連絡ください',
    from: '田中建設 田中部長',
    deadline: '本日17時まで',
    action: '電話 or メール返信',
    category: 'メール',
    type: 'メール',
    importance: 'high',
    status: '未対応',
    isRead: false,
    detail: {
      summary: '田中建設から工事代金¥2,200,000の未払いについて至急連絡要請。既に支払期日から14日超過。',
      background:
        '6/12に工事完了後、請求書を送付済み。6/25に田中部長から電話連絡あり。関係性は良好だが今回は異例の強い催促。',
      recommendedActions: [
        '本日中に田中部長へ電話で謝罪・支払い時期の説明',
        '経理に支払い手続きを即時確認',
        '次回からの支払い管理を強化',
      ],
      replyDraft: `田中部長\n\nお世話になっております。坂本でございます。\nこの度は工事代金のご入金が遅延しており、誠に申し訳ございません。\n\n本日中に経理担当に確認し、今週中に必ずご対応いたします。\nご迷惑をおかけし、深くお詫び申し上げます。\n\nLCC株式会社 代表取締役 坂本`,
      nextSteps: ['経理部に支払い状況を確認', '田中部長に電話で状況説明', '支払い完了後に一報入れる'],
      relatedData: ['請求書 #2024-071（¥2,200,000）', '工事完了報告書 6/12', '過去取引 3件（全て円満）'],
    },
  },
  {
    id: 'a2',
    priority: 'A',
    subject: '銀行融資審査書類の追加提出依頼',
    from: '三菱UFJ銀行 佐藤担当',
    deadline: '本日中',
    action: '書類準備・提出',
    category: 'メール',
    type: '銀行',
    importance: 'high',
    status: '未対応',
    isRead: false,
    detail: {
      summary: '¥30,000,000の融資審査で追加書類（直近3ヶ月の入出金明細、資金繰り表）の提出を求められている。',
      background: '5月末に融資申込済み。審査は順調だったが、今月売上の急増により追加確認が必要とのこと。',
      recommendedActions: [
        '経理に入出金明細の即時準備を依頼',
        '資金繰り表をfreeeから出力',
        'PDFで佐藤担当にメール送付',
      ],
      replyDraft: `佐藤様\n\nお世話になっております。LCC株式会社 坂本です。\n追加書類の件、承知いたしました。\n本日中に直近3ヶ月の入出金明細および資金繰り表をご送付いたします。\n\nご確認よろしくお願いいたします。`,
      nextSteps: ['経理から入出金明細を取得', '資金繰り表を作成', '本日17時までに送付'],
      relatedData: ['融資申込書（5/31提出）', '審査通知書（6/20受領）', '申込融資額 ¥30,000,000'],
    },
  },
  {
    id: 'a3',
    priority: 'A',
    subject: '現場事故報告 ― 作業員軽傷',
    from: '加藤現場監督',
    deadline: '即日対応',
    action: '状況確認・指示',
    category: 'LINE WORKS',
    type: '事故',
    importance: 'high',
    status: '対応中',
    isRead: false,
    detail: {
      summary: '○○リフォーム現場で作業員（外注 山田設備）が脚立から転落。足首捻挫の軽傷。病院受診済み、就労不能ではない。',
      background: '6/25 13:40発生。すぐに病院へ搬送。家族への連絡は済み。労災申請が必要な可能性あり。',
      recommendedActions: [
        '加藤監督から詳細状況を確認',
        '社労士に労災申請の要否を相談',
        '再発防止策を検討・指示',
      ],
      replyDraft: `加藤監督\n\n状況報告ありがとう。山田さんの怪我の具合が心配です。\n今すぐ現場の状況を電話で教えてください。\n病院の診断書もコピーしておいてください。\n\n社長`,
      nextSteps: ['加藤監督へ即時電話', '社労士への報告・相談', '再発防止策の文書化'],
      relatedData: ['現場：○○リフォーム工事（6/20〜7/15）', '外注：山田設備株式会社', '発生時刻：6/25 13:40'],
    },
  },
  {
    id: 'b1',
    priority: 'B',
    subject: '外注業者との単価改定交渉 回答依頼',
    from: '株式会社植竹 経理',
    deadline: '今週金曜',
    action: '方針決定・返信',
    category: 'メール',
    type: '契約',
    importance: 'medium',
    status: '未対応',
    isRead: true,
    detail: {
      summary: '主要外注業者3社から単価15%引き上げ要求。回答期限は今週金曜。現状の外注費は月¥8,500,000。',
      background: '材料費・人件費高騰が理由。業界全体のトレンド。断ると代替業者の確保が必要になる。',
      recommendedActions: ['社内での方針会議（今週水曜）', '10%引き上げで交渉', '長期契約での条件交渉'],
      replyDraft: `担当者様\n\n単価改定のご提案を承りました。\n社内で検討し、今週金曜日までに回答いたします。\nよろしくお願いいたします。`,
      nextSteps: ['社内で単価見直しの影響額を計算', '方針会議で決定', '金曜日までに回答'],
      relatedData: ['現外注費 月¥8,500,000', '主要外注3社（山田設備・田中工務・佐藤電気）'],
    },
  },
  {
    id: 'b2',
    priority: 'B',
    subject: '新規案件見積もり依頼（戸建てリフォーム）',
    from: '山田様（個人）',
    deadline: '今週中',
    action: '見積作成・送付',
    category: 'メール',
    type: 'メール',
    importance: 'medium',
    status: '未対応',
    isRead: true,
    detail: {
      summary: '戸建てリフォーム（外壁・屋根・内装）の見積依頼。概算 ¥3,000,000〜5,000,000 規模。',
      background: '紹介案件。紹介元は既存顧客の鈴木様。確度は高い。今週中に見積を出すと受注確率アップ。',
      recommendedActions: ['現地調査の日程調整', '見積書作成', '今週金曜までに提出'],
      replyDraft: `山田様\n\nお問い合わせありがとうございます。LCC株式会社 坂本です。\n現地拝見の上、詳細なお見積りをお出しします。\n今週中のご都合をお聞かせいただけますか？`,
      nextSteps: ['山田様への連絡・現地調査日程調整', '現地調査', '見積書作成・提出'],
      relatedData: ['紹介元：鈴木様（既存顧客）', '対象物件：○○市△△町の戸建て'],
    },
  },
  {
    id: 'b3',
    priority: 'B',
    subject: '社員研修日程の最終確認',
    from: '人事 鈴木',
    deadline: '来週月曜まで',
    action: '日程承認',
    category: 'LINE WORKS',
    type: 'LINE WORKS',
    importance: 'low',
    status: '確認中',
    isRead: true,
    detail: {
      summary: '7月の安全衛生研修（外部講師）の日程を2案から選ぶ必要あり。A案：7/10（木）、B案：7/17（木）。',
      background: '法定研修のため実施必須。外部講師の都合でこの2択のみ。社員15名参加予定。',
      recommendedActions: ['社内スケジュールを確認', 'A案 7/10を選択（現場が少ない日）'],
      replyDraft: `鈴木さん\n\nA案（7/10）で進めてください。\nよろしくお願いします。`,
      nextSteps: ['日程確定の返信', '社員への告知'],
      relatedData: ['参加人数：15名', '外部講師：安全衛生センター 田村先生'],
    },
  },
  {
    id: 'w1',
    priority: 'waiting-confirm',
    subject: 'freee請求書 #2024-089 入金確認待ち',
    from: '経理 山本',
    deadline: '入金予定 6/28',
    action: '入金確認後クローズ',
    category: '経理',
    type: '請求',
    importance: 'medium',
    status: '確認中',
    isRead: true,
    detail: {
      summary: '○○建設あて請求書 ¥4,800,000の入金待ち。期日は6/28。過去に遅延実績なし。',
      background: '5月分工事代金。先方からの支払い確認書は受領済み。',
      recommendedActions: ['6/28に入金確認', '未着の場合は先方経理へ連絡'],
      replyDraft: '',
      nextSteps: ['6/28 午後に入金確認'],
      relatedData: ['請求書 #2024-089', '金額 ¥4,800,000', '支払確認書受領済み'],
    },
  },
  {
    id: 'w2',
    priority: 'waiting-confirm',
    subject: '外注見積もり回答待ち（水道工事）',
    from: '山田設備',
    deadline: '返答待ち',
    action: '回答次第発注判断',
    category: 'メール',
    type: '現場',
    importance: 'medium',
    status: '確認中',
    isRead: true,
    detail: {
      summary: '新規案件の水道工事部分を山田設備に見積り依頼中。回答は6/27予定。',
      background: '元請け案件の工事開始は7/5予定。外注費が高ければ自社施工の検討が必要。',
      recommendedActions: ['6/27に回答がなければ催促', '見積額次第で発注判断'],
      replyDraft: '',
      nextSteps: ['6/27に確認の連絡'],
      relatedData: ['発注予定案件：△△ビル改修工事', '工事開始：7/5'],
    },
  },
  {
    id: 'wc1',
    priority: 'waiting-create',
    subject: '○○建設向け工事提案書',
    from: '自分',
    deadline: '今週中に作成',
    action: 'AIで資料作成',
    category: '作成',
    type: '承認',
    importance: 'medium',
    status: '未対応',
    isRead: true,
    detail: {
      summary: '○○建設への新規提案。外壁改修と屋根防水の合わせ提案。予算は¥8,000,000前後。',
      background: '先月の現場視察で潜在ニーズを確認。今月中に提案書を提出すれば受注確率が高い。',
      recommendedActions: ['AI社長室の作成依頼から「プレゼン構成」で作成'],
      replyDraft: '',
      nextSteps: ['提案書作成（AIで下書き）', '社内レビュー', '先方に提出'],
      relatedData: ['対象：○○建設 本社ビル（築30年）', '予算感 ¥8,000,000前後'],
    },
  },
]

// ── チャット初期メッセージ ─────────────────────────────────
export const initialChatMessages: ChatMessage[] = [
  {
    id: 'init',
    role: 'assistant',
    content:
      'おはようございます、坂本社長。\n本日は要対応が **3件（優先度A）** あります。\n\n何でもお申し付けください。メール返信文の作成、資料作成、経営情報の確認など、すぐにサポートします。\n\n上のタブで担当AIを切り替えられます。',
    timestamp: new Date(),
  },
]

// ── 経営ダッシュボード：主要指標 ──────────────────────────
export const dashboardMetrics: DashboardMetric[] = [
  { id: 'm1', label: '今月売上', value: '¥28,400,000', subValue: '前月比 +12%', trend: 'up' },
  { id: 'm2', label: '今月粗利', value: '¥8,120,000', subValue: '粗利率 28.6%', trend: 'up' },
  { id: 'm3', label: '現金残高', value: '¥4,200,000', subValue: '先月比 −8%', trend: 'down', alert: true, alertLevel: 'warning' },
  { id: 'm4', label: '入金予定（今月）', value: '¥15,600,000', subValue: '3件', trend: 'neutral' },
  { id: 'm5', label: '支払予定（今月）', value: '¥11,200,000', subValue: '外注費含む', trend: 'neutral' },
  { id: 'm6', label: '銀行借入残高', value: '¥45,000,000', subValue: '3行合計', trend: 'neutral' },
  { id: 'm7', label: '未請求案件', value: '3件', subValue: '¥6,800,000', alert: true, alertLevel: 'warning', trend: 'neutral' },
  { id: 'm8', label: '未回収', value: '¥4,200,000', subValue: '最長42日超過', alert: true, alertLevel: 'warning', trend: 'neutral' },
  { id: 'm9', label: '事故・クレーム', value: '1件対応中', subValue: '6/25発生・軽傷', alert: true, alertLevel: 'danger', trend: 'neutral' },
  { id: 'm10', label: '社員稼働率', value: '87%', subValue: '現場2チーム不足', alert: true, alertLevel: 'warning', trend: 'down' },
]

// ── 13週資金繰り ──────────────────────────────────────────
export const cashflowWeeks: CashflowWeek[] = [
  { week: '6/27', label: '6/27週', income: 3200, expense: 1850, balance: 4200, alert: false },
  { week: '7/4', label: '7/4週', income: 800, expense: 3500, balance: 1500, alert: true, alertLevel: 'danger' },
  { week: '7/11', label: '7/11週', income: 4800, expense: 2200, balance: 4100, alert: false },
  { week: '7/18', label: '7/18週', income: 1200, expense: 3800, balance: 1500, alert: true, alertLevel: 'warning' },
  { week: '7/25', label: '7/25週', income: 6200, expense: 2100, balance: 5600, alert: false },
  { week: '8/1', label: '8/1週', income: 2400, expense: 4200, balance: 3800, alert: false },
  { week: '8/8', label: '8/8週', income: 900, expense: 3100, balance: 1600, alert: true, alertLevel: 'warning' },
  { week: '8/15', label: '8/15週', income: 5100, expense: 1800, balance: 4900, alert: false },
  { week: '8/22', label: '8/22週', income: 3300, expense: 2600, balance: 5600, alert: false },
  { week: '8/29', label: '8/29週', income: 1100, expense: 4800, balance: 1900, alert: true, alertLevel: 'warning' },
  { week: '9/5', label: '9/5週', income: 7200, expense: 2300, balance: 6800, alert: false },
  { week: '9/12', label: '9/12週', income: 2200, expense: 3500, balance: 5500, alert: false },
  { week: '9/19', label: '9/19週', income: 4100, expense: 2900, balance: 6700, alert: false },
]

// ── 案件粗利ランキング ─────────────────────────────────────
export const projectMetrics: ProjectMetric[] = [
  { id: 'p1', name: '△△ビル外壁改修', client: '○○建設', grossProfit: 2800000, grossProfitRate: 35, status: '施工中' },
  { id: 'p2', name: '戸建リフォームA', client: '山田様', grossProfit: 1200000, grossProfitRate: 30, status: '見積中' },
  { id: 'p3', name: '□□マンション修繕', client: '不動産B社', grossProfit: 980000, grossProfitRate: 22, status: '施工中', alert: true },
  { id: 'p4', name: '工場屋根防水工事', client: 'C工場', grossProfit: 750000, grossProfitRate: 18, status: '完了', alert: true },
  { id: 'p5', name: '住宅外構工事', client: '鈴木様', grossProfit: 650000, grossProfitRate: 28, status: '施工中' },
]

// ── 部署別利益 ─────────────────────────────────────────────
export const departmentMetrics: DepartmentMetric[] = [
  { id: 'd1', name: '工務部', revenue: 18200000, profit: 5460000, profitRate: 30 },
  { id: 'd2', name: '営業部', revenue: 7400000, profit: 1850000, profitRate: 25 },
  { id: 'd3', name: '事務部', revenue: 2800000, profit: 810000, profitRate: 29 },
]

// ── 作成テンプレート ───────────────────────────────────────
export const createTemplates: CreateTemplate[] = [
  { id: 'c1', label: '社内連絡文', icon: '📝', description: '社員向けの通知・連絡文', category: '社内' },
  { id: 'c2', label: '返信文', icon: '↩️', description: 'メール・LINE WORKSへの返信', category: '対外' },
  { id: 'c3', label: '銀行資料', icon: '🏦', description: '融資・審査用の説明資料', category: '対外' },
  { id: 'c4', label: '契約書たたき台', icon: '📄', description: '契約書の初期ドラフト作成', category: '対外' },
  { id: 'c5', label: 'プレゼン構成', icon: '📊', description: '提案・報告用スライド構成', category: '対外' },
  { id: 'c6', label: '議事録', icon: '🗒️', description: '会議・打合せの議事録', category: '社内' },
  { id: 'c7', label: 'タスクリスト', icon: '✅', description: 'プロジェクト別タスク整理', category: '社内' },
  { id: 'c8', label: 'Manus指示文', icon: '🤖', description: 'Manusへの作業依頼テキスト', category: 'AI指示' },
  { id: 'c9', label: 'Claude Code指示文', icon: '💻', description: 'Claude Codeへの開発指示', category: 'AI指示' },
  { id: 'c10', label: 'Gemini指示文', icon: '✨', description: 'Geminiへの分析・生成指示', category: 'AI指示' },
]

// ── 連携サービス ──────────────────────────────────────────
export const integrations: Integration[] = [
  {
    id: 'gmail',
    name: 'Gmail',
    icon: '📧',
    status: 'planned',
    readMode: '読み取り予定',
    note: 'Phase 2で接続予定。未読メールの優先度分類に使用',
  },
  {
    id: 'gcal',
    name: 'Googleカレンダー',
    icon: '📅',
    status: 'planned',
    readMode: '読み取り予定',
    note: '今日の予定・リマインダーとの統合',
  },
  {
    id: 'gdrive',
    name: 'Google Drive',
    icon: '📁',
    status: 'planned',
    readMode: '検索予定',
    note: '資料検索・参照のみ。書き込み不可',
  },
  {
    id: 'lineworks',
    name: 'LINE WORKS',
    icon: '💬',
    status: 'planned',
    readMode: '通知予定',
    note: '重要メッセージの取得・通知のみ',
  },
  {
    id: 'gsheet',
    name: 'Googleスプレッドシート',
    icon: '📊',
    status: 'planned',
    readMode: '読み取り予定',
    note: '経営数値の読み取り。書き込み不可',
  },
  {
    id: 'freee',
    name: 'freee',
    icon: '💹',
    status: 'planned',
    readMode: '将来連携',
    note: '請求書・入出金データの取得',
  },
  {
    id: 'tkc',
    name: 'TKC',
    icon: '🏢',
    status: 'planned',
    readMode: '将来連携',
    note: '月次試算表・資金繰り表の取得',
  },
]

// ── API連携ポイント（将来） ───────────────────────────────
export const apiIntegrationPoints: ApiIntegrationPoint[] = [
  {
    feature: 'AI相談チャット',
    endpoint: 'POST /api/chat',
    provider: 'Claude API (claude-opus-4-8) — ストリーミング',
    note: 'AIモード別システムプロンプト切り替え',
    phase: 2,
  },
  {
    feature: '今日の要対応',
    endpoint: 'GET /api/actions',
    provider: 'Gmail API + LINE WORKS API',
    note: '優先度分類・種別判定はClaude APIで実行',
    phase: 2,
  },
  {
    feature: '経営ダッシュボード',
    endpoint: 'GET /api/dashboard',
    provider: 'freee API + Google Sheets API + TKC',
    note: '月次集計・キャッシュ1時間、書き込み不可',
    phase: 3,
  },
  {
    feature: '13週資金繰り',
    endpoint: 'GET /api/cashflow',
    provider: 'freee API + Google Sheets API',
    note: '週次更新、アラート閾値は設定で変更可',
    phase: 3,
  },
  {
    feature: '作成依頼',
    endpoint: 'POST /api/create',
    provider: 'Claude API',
    note: 'テンプレート別システムプロンプト・出力形式対応',
    phase: 2,
  },
  {
    feature: 'Gmail下書き保存',
    endpoint: 'POST /api/gmail/draft',
    provider: 'Gmail API (下書き作成のみ)',
    note: '送信は絶対に行わない。下書き保存のみ',
    phase: 4,
  },
  {
    feature: 'Google Drive保存',
    endpoint: 'POST /api/drive/save',
    provider: 'Google Drive API',
    note: '指定フォルダへのファイル作成のみ',
    phase: 4,
  },
  {
    feature: '設定保存',
    endpoint: 'PUT /api/settings',
    provider: 'ローカルDB (SQLite)',
    note: 'Phase 1ではlocalStorageで代替',
    phase: 1,
  },
]

// ── モックAI応答 ──────────────────────────────────────────
export const mockAiResponses: Record<string, Record<string, string>> = {
  secretary: {
    今日: '**今日のやるべきこと（秘書モード）：**\n\n🔴 午前中に必ず対応\n1. 三菱UFJ 佐藤担当へ書類提出\n2. 田中建設 田中部長に電話\n3. 現場事故の加藤監督へ連絡\n\n📋 午後\n4. freee入金確認\n5. 山田設備の見積り確認待ち\n\n📝 今週中\n6. 外注単価交渉の方針決定\n7. 研修日程の承認',
    昨日: '**昨日からの変化（3件）：**\n\n🔴 銀行から追加資料依頼（本日中要提出）\n🟡 現場事故報告 1件（加藤監督より）\n🟡 未請求案件 3件・合計 ¥6,800,000\n\n最優先は銀行書類です。',
    default:
      '承知しました。[AI秘書モード]\n\nClaude API接続後は、Gmail・LINE WORKSと連携し、社長の状況を常にリアルタイムで把握・整理します。',
  },
  management: {
    資金: '**資金繰りリスク分析（経営モード）：**\n\n⚠️ 7/4週が最もリスク高\n• 入金: ¥800,000 vs 支払: ¥3,500,000\n• 残高が ¥1,500,000 まで低下\n\n対策案：\n1. ¥4,800,000の入金を前倒し交渉\n2. 外注費支払を翌週にずらす\n3. 銀行の当座借越を活用',
    粗利: '**粗利悪化案件：**\n\n🔴 □□マンション修繕（22%）\n→ 当初30%予定。追加工事で材料費増加\n\n🔴 工場屋根防水工事（18%）\n→ 雨天で工期延長。人件費がかさんだ\n\n対策：次回から同種工事の見積りに5%バッファを追加',
    default:
      '承知しました。[AI経営モード]\n\nfreee API・TKC連携後は、財務データをリアルタイムで分析し、資金繰りリスクを事前に警告します。',
  },
  field: {
    現場: '**今日の現場状況：**\n\n🔴 ○○リフォーム — 事故発生・対応中\n🟡 △△ビル — 資材搬入遅れ（本日15:00予定）\n🟢 □□マンション — 予定通り進行\n🟢 戸建外構A — 午後仕上げ工程\n🟢 工場屋根 — 完了確認中',
    人員: '**人員不足状況：**\n\n⚠️ 来週3チーム同時稼働で2名不足\n• ○○リフォーム: 電気工事1名\n• △△ビル: 左官工1名\n\n対応策：\n1. 協力会社・大工田中さんに連絡\n2. 来週月曜からの応援手配',
    default:
      '承知しました。[AI現場モード]\n\nLINE WORKS連携後は、現場監督からのリアルタイム報告を自動集約・アラート化します。',
  },
  admin: {
    メール: '**返信が必要なメール（事務モード）：**\n\n🔴 田中建設 田中部長（至急）\n🟡 三菱UFJ 佐藤担当（本日中）\n🟡 山田様・見積依頼（今週中）\n🟡 外注単価交渉（今週金曜）\n\n返信文を作成する場合は「返信文を作って」とお伝えください。',
    請求: '**請求漏れ確認：**\n\n⚠️ 未請求案件 3件\n• ○○工事（完了済）¥2,800,000\n• △△修繕（完了済）¥2,400,000\n• □□外構（完了済）¥1,600,000\n\n合計 ¥6,800,000。経理に今週中の請求書発行を依頼してください。',
    default:
      '承知しました。[AI事務モード]\n\nGmail・freee連携後は、未返信メール・未請求案件を自動検出・リスト化します。',
  },
  sales: {
    追客: '**追客すべき案件：**\n\n🔴 ○○建設（提案書提出から21日超過）\n🟡 鈴木様リフォーム（見積提出から7日）\n🟡 B不動産（先月の現場視察後フォローなし）\n\n優先度順に今週中に連絡することを推奨します。',
    見積: '**見積提出後の未回答案件：**\n\n1. ○○建設 — 提案書提出 6/5（21日経過）\n2. 鈴木様 — 見積提出 6/19（7日経過）\n3. △△㈱ — 見積提出 6/22（4日経過）\n\n○○建設への追客電話を今日中に行うことを推奨。',
    default:
      '承知しました。[AI営業モード]\n\nfreee・Google Sheets連携後は、見積から受注までのパイプライン管理を自動化します。',
  },
  welfare: {
    確認: '**お結び確認事項：**\n\n📋 今月の確認事項\n• 利用者ケアプラン 2件 更新期限（6/30）\n• サービス担当者会議 未実施 2件\n• 処遇改善加算 7月分 書類準備\n\n🔴 優先：ケアプラン更新は期限切れ厳禁',
    監査: '**監査・行政対応：**\n\n7月の定期指導監査に向けた準備状況\n🟡 記録整備：80%完了\n🟡 加算算定根拠：要確認\n🟢 人員配置：基準内\n\n残り作業を今月中に完了させてください。',
    default:
      '承知しました。[AI福祉モード]\n\n介護・福祉系業務の記録管理・加算算定・監査対応をサポートします。',
  },
}
