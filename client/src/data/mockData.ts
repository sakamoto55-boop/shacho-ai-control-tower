import type {
  AiModeConfig,
  ActionItem,
  AiJudgement,
  Briefing,
  CashflowWeek,
  ChatMessage,
  Company,
  CompanyHealthScore,
  CreateTemplate,
  DashboardMetric,
  DepartmentMetric,
  Integration,
  PriorityAction,
  ProjectMetric,
  SearchResult,
  SituationCard,
  TimelinePeriodData,
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
    Gmail: '**Gmailからの要対応（デモデータ）：**\n\n🔴 優先度A — 2件\n1. 【至急】融資審査に係る追加書類の提出について（銀行・本日中）\n2. 工事代金の未払いについてご連絡（A社・今週中）\n\n🟡 優先度B — 2件\n3. 労働安全衛生法に基づく書類提出（7月10日）\n4. B現場 追加外注費の承認依頼（今日中）\n\n返信文は「要対応」画面の各メールから確認できます。\n\n⚠️ 送信はPhase後工程。内容確認後、手動でお送りください。',
    返信: '**返信が必要なメール（優先順）：**\n\n🔴 1位: 銀行 — 融資審査追加書類（本日中）\n🔴 2位: A社 — 工事代金未払い請求（今週中）\n🟡 3位: 加藤監督 — 外注費承認依頼（今日中）\n🟡 4位: B社 — 契約書確認・返送（今週中）\n\n返信文たたき台は「要対応」画面で確認・コピーできます。',
    銀行: '**銀行からのメール：**\n\n📧 件名：【至急】融資審査に係る追加書類の提出について\n👤 送信者：○○銀行 法人営業部 山田\n⏰ 期限：本日中\n\n内容：融資審査に際し、下記の提出を依頼\n・直近3ヶ月の試算表\n・売掛金一覧表\n・主要取引先一覧\n\n⚠️ 返信文は「要対応」画面からコピーして手動送信してください。',
    今日中: '**今日中に対応が必要なメール：**\n\n🔴 1件\n「【至急】融資審査に係る追加書類の提出について」\n→ ○○銀行 山田様 / 本日中が期限\n→ 書類を準備して手動で返信してください\n\n🟡 1件（今日中に決めるべき）\n「B現場 追加外注費の承認依頼」\n→ 加藤監督 / 今日中に決定しないと工程が止まる\n→ ¥480,000の承認判断が必要',
    返信文: '**返信文たたき台の確認方法：**\n\n1. 「今日の要対応」画面を開く\n2. 「Gmailからの要対応」セクションを確認\n3. 返信したいメールの「詳細・返信文たたき台を見る」をタップ\n4. 内容確認後「返信文をコピー」ボタンでコピー\n5. GmailまたはメールアプリにペーストしてOK\n\n⚠️ 送信ボタンはありません。必ず手動で送信してください。',
    今日: '**今日のやるべきこと（秘書モード）：**\n\n🔴 午前中に必ず対応\n1. 三菱UFJ 佐藤担当へ書類提出\n2. 田中建設 田中部長に電話\n3. 現場事故の加藤監督へ連絡\n\n📧 Gmailからも要対応あり\n4. 融資審査追加書類（銀行・本日中）\n5. B現場外注費承認（加藤監督・今日中）\n\n📋 午後\n6. freee入金確認\n7. 山田設備の見積り確認待ち\n\n📝 今週中\n8. 外注単価交渉の方針決定\n9. 研修日程の承認',
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

// ── Phase 3: 会社健康スコア ────────────────────────────────
export const companyHealthScore: CompanyHealthScore = {
  total: 67,
  grade: 'C',
  comment:
    '資金繰りと未請求案件の回収遅れが全体スコアを押し下げています。事故対応が長引いており、今週中に銀行資料・未請求・事故の3点を処理することが急務です。',
  updatedAt: '2026-06-26 07:30',
  breakdown: [
    { category: '資金繰り', status: 'warning', label: '注意', icon: '💰', score: 55 },
    { category: '粗利率',   status: 'good',    label: '良好', icon: '📊', score: 82 },
    { category: '未請求',   status: 'danger',  label: '要対応', icon: '🧾', score: 40 },
    { category: '事故対応', status: 'danger',  label: '要対応', icon: '🚨', score: 38 },
    { category: '人員配置', status: 'warning', label: 'やや不足', icon: '👷', score: 60 },
    { category: '営業',     status: 'normal',  label: '普通', icon: '📋', score: 70 },
  ],
}

// ── Phase 3: AI優先順位アクション ─────────────────────────
export const priorityActions: PriorityAction[] = [
  {
    id: 'pa1',
    rank: 1,
    title: '銀行追加資料の準備・提出',
    importance: 'critical',
    deadline: '本日17:00',
    reason:
      '三菱UFJ銀行から融資審査のための追加資料提出を求めるメールが届いています。期限は本日17時で、回答が遅れると審査がリセットされる可能性があります。',
    recommendedAction: '事業計画書の最新版と直近3ヶ月の試算表を添付して返信する',
    category: '銀行',
    relatedScreen: 'actions',
    suggestions: [
      {
        id: 'pa1-s1',
        label: '返信文を作る',
        icon: '✉️',
        type: 'reply',
        draft: `【銀行返信文 — 仮生成サンプル】

三菱UFJ銀行
佐藤担当者様

お世話になっております。LCC株式会社 代表取締役 坂本でございます。
この度はご連絡いただきありがとうございます。

ご要望の追加資料につきまして、以下のとおり準備いたしました。

添付書類：
・事業計画書（最新版）
・直近3ヶ月試算表（4月〜6月）
・受注見込み一覧

ご確認のほど、何卒よろしくお願いいたします。

LCC株式会社
代表取締役 坂本

※ これは仮生成サンプルです。Claude API接続後は実際の状況に合わせた文章が自動生成されます。`,
      },
      {
        id: 'pa1-s2',
        label: '資料作成へ',
        icon: '📄',
        type: 'document',
        draft: `【銀行向け資料 — 構成案（仮）】

■ 表紙
　LCC株式会社 / 追加資料 / 2026年6月26日

■ 1. 直近の事業状況
　・売上推移（4月〜6月）：¥28.4M（前年比+12%）
　・粗利率：28.6%（業界平均25%を上回る）
　・受注残：¥45M（7月〜9月分）

■ 2. 資金繰り計画
　・7月〜9月の入金・支出予測
　・資金ショートリスクへの対策

■ 3. 融資の用途と返済計画
　・使途：設備投資（現場機材）
　・返済：月額¥450,000 / 60ヶ月

※ これは仮生成サンプルです。`,
      },
    ],
  },
  {
    id: 'pa2',
    rank: 2,
    title: '現場事故の状況確認と対応指示',
    importance: 'critical',
    deadline: '本日中',
    reason:
      '○○リフォーム現場で昨日発生した事故について、顧客への報告と保険会社への連絡がまだ完了していません。放置すると法的リスクおよびクレーム拡大につながります。',
    recommendedAction: '現場責任者から詳細を確認し、顧客・保険会社に状況報告を行う',
    category: '事故',
    relatedScreen: 'actions',
    suggestions: [
      {
        id: 'pa2-s1',
        label: '担当へ依頼文を作る',
        icon: '📨',
        type: 'delegate',
        draft: `【現場担当者への指示文 — 仮生成サンプル】

工務部 現場担当者 各位

代表取締役 坂本より

○○リフォーム現場の事故対応について、本日中に以下を実施してください。

【本日の対応事項】
1. 事故状況の詳細を写真・図面で記録する
2. 顧客（○○様）へ現状報告の連絡を入れる
3. 損害保険会社（△△損保）に事故通知を行う
4. 再発防止策を本日中に坂本まで報告する

期限：本日18:00まで

緊急の場合は直接連絡してください。

LCC株式会社 代表取締役 坂本

※ これは仮生成サンプルです。`,
      },
      {
        id: 'pa2-s2',
        label: '顧客への報告文を作る',
        icon: '✉️',
        type: 'reply',
        draft: `【顧客報告文 — 仮生成サンプル】

○○様

平素より大変お世話になっております。
LCC株式会社 代表取締役 坂本でございます。

このたびは、現場作業中に不慮の事故が発生いたしまして、誠に申し訳ございません。

現在の状況と対応についてご報告申し上げます。

【発生状況】
6月25日（木）午後、作業中に○○が発生いたしました。

【対応状況】
・作業を一時停止し、安全確認を完了しています
・損害保険会社への連絡を行っております
・再発防止策を検討中です

【今後のスケジュール】
本日中に詳細なご報告をさせていただきます。

ご心配をおかけして大変申し訳ございません。

LCC株式会社 代表取締役 坂本

※ これは仮生成サンプルです。`,
      },
    ],
  },
  {
    id: 'pa3',
    rank: 3,
    title: '未請求案件3件の担当確認',
    importance: 'high',
    deadline: '本日中',
    reason:
      '完了済み案件3件（合計¥6,800,000）の請求書がまだ発行されていません。月末を過ぎると翌月計上になり、資金繰りにさらに影響します。',
    recommendedAction: '経理担当者に今週中の請求書発行を依頼し、入金予定日を確認する',
    category: '請求',
    relatedScreen: 'actions',
    suggestions: [
      {
        id: 'pa3-s1',
        label: '担当へ依頼文を作る',
        icon: '📨',
        type: 'delegate',
        draft: `【経理担当者への依頼文 — 仮生成サンプル】

経理担当 各位

代表取締役 坂本より

以下の完了済み案件について、今週金曜日（6/27）までに請求書を発行してください。

【未請求案件リスト】
1. ○○工事（完了：6/10）
　　金額：¥2,800,000
　　請求先：田中建設 田中部長

2. △△修繕（完了：6/15）
　　金額：¥2,400,000
　　請求先：山田物産 山田様

3. □□外構工事（完了：6/20）
　　金額：¥1,600,000
　　請求先：鈴木ハウス 鈴木様

合計：¥6,800,000

発行後、各先様の入金予定日を確認して坂本まで報告してください。

LCC株式会社 代表取締役 坂本

※ これは仮生成サンプルです。`,
      },
      {
        id: 'pa3-s2',
        label: '詳細を見る',
        icon: '🔍',
        type: 'detail',
        draft: `【未請求案件 詳細 — 仮データ】

■ 案件1：○○工事
　完了日：2026年6月10日
　請求金額：¥2,800,000（税込）
　請求先：田中建設株式会社 田中部長
　入金サイト：完了後30日
　予定入金日：2026年7月10日

■ 案件2：△△修繕工事
　完了日：2026年6月15日
　請求金額：¥2,400,000（税込）
　請求先：山田物産株式会社 山田様
　入金サイト：完了後30日
　予定入金日：2026年7月15日

■ 案件3：□□外構工事
　完了日：2026年6月20日
　請求金額：¥1,600,000（税込）
　請求先：鈴木ハウス 鈴木様
　入金サイト：完了後30日
　予定入金日：2026年7月20日

合計未請求額：¥6,800,000

※ これは仮データです。`,
      },
    ],
  },
  {
    id: 'pa4',
    rank: 4,
    title: '工事代金未払い先への連絡',
    importance: 'high',
    deadline: '今週中',
    reason:
      'B工務店への工事代金¥1,800,000が支払期限から2週間超過しています。このまま放置すると回収リスクが高まります。',
    recommendedAction: 'まず電話で状況確認。回答次第で内容証明の準備を検討する',
    category: '請求',
    relatedScreen: 'actions',
    suggestions: [
      {
        id: 'pa4-s1',
        label: '督促文を作る',
        icon: '✉️',
        type: 'reply',
        draft: `【支払督促文 — 仮生成サンプル】

B工務店
担当者様

お世話になっております。LCC株式会社 坂本でございます。

さて、6月10日付請求書（請求金額 ¥1,800,000）について、支払期日（6月15日）を経過しておりますが、いまだご入金の確認が取れておりません。

お手数ですが、お振込みの予定をご確認いただき、6月28日（金）までにご連絡をいただけますでしょうか。

何かご不明な点がございましたら、お気軽にご連絡ください。

LCC株式会社 代表取締役 坂本

※ これは仮生成サンプルです。`,
      },
      {
        id: 'pa4-s2',
        label: '保留にする',
        icon: '⏸️',
        type: 'postpone',
        draft: `【保留メモ — 仮生成サンプル】

案件：B工務店 工事代金回収
金額：¥1,800,000
保留理由：（理由を入力してください）
次回確認日：2026年7月3日

この項目を一時保留としました。
設定した日付に再通知します。

※ これは仮機能のサンプルです。`,
      },
    ],
  },
  {
    id: 'pa5',
    rank: 5,
    title: '人員不足現場への応援手配',
    importance: 'medium',
    deadline: '明日まで',
    reason:
      '来週3現場が同時進行となりますが、電気工事1名・左官工1名が不足しています。明日までに手配しないと来週の工程が止まります。',
    recommendedAction: '協力会社リストから電気工事業者と左官業者に今日中に連絡する',
    category: '現場',
    relatedScreen: 'actions',
    suggestions: [
      {
        id: 'pa5-s1',
        label: '予定登録案を作る',
        icon: '📅',
        type: 'schedule',
        draft: `【予定登録案 — 仮生成サンプル】

タイトル：人員手配確認（来週分）
日時：2026年6月27日（土）9:00
場所：事務所 / 電話対応
担当：坂本（代表）

確認事項：
1. 協力電気工事業者（田中電気）に連絡
　　来週月〜水の応援可否確認

2. 左官業者（山田左官）に連絡
　　来週火〜木の応援可否確認

3. 応援不可の場合は別の業者リスト確認

備考：
人員が確保できない場合は工程調整を検討する

※ これはカレンダー登録案です（実際には登録されません）。`,
      },
      {
        id: 'pa5-s2',
        label: '依頼文を作る',
        icon: '📨',
        type: 'delegate',
        draft: `【協力業者への依頼文 — 仮生成サンプル】

田中電気工業 田中社長

お世話になっております。LCC株式会社の坂本です。

来週（6月30日〜7月4日）の現場について、電気工事の応援をお願いしたくご連絡しました。

【必要な応援内容】
期間：6月30日（月）〜7月2日（水）
現場：○○リフォーム（○○市○○町）
作業：電気配線工事、コンセント増設
人数：1名

お手間をおかけして恐縮ですが、ご都合をお聞かせいただけますでしょうか。

LCC株式会社 代表取締役 坂本

※ これは仮生成サンプルです。`,
      },
    ],
  },
]

// ── Phase 3: 時系列ビュー ──────────────────────────────────
export const timelinePeriods: TimelinePeriodData[] = [
  {
    period: 'yesterday',
    label: '昨日',
    events: [
      { id: 'y1', title: '○○リフォーム現場で事故発生', category: '事故', alertLevel: 'danger', time: '14:30' },
      { id: 'y2', title: '三菱UFJ銀行より追加資料要請メール受信', category: '銀行', alertLevel: 'warning', time: '10:15' },
      { id: 'y3', title: '未請求案件3件が発覚（合計¥6.8M）', category: '請求', alertLevel: 'warning', time: '09:00' },
      { id: 'y4', title: 'B工務店 未払い確認（期限超過14日）', category: '回収', alertLevel: 'warning', time: '16:00' },
      { id: 'y5', title: '□□外構工事 完了報告受領', category: '現場', time: '17:30' },
    ],
  },
  {
    period: 'today',
    label: '今日',
    events: [
      { id: 't1', title: '銀行追加資料 提出期限（17:00）', category: '銀行', alertLevel: 'danger', time: '17:00' },
      { id: 't2', title: '事故現場 状況確認・顧客報告', category: '事故', alertLevel: 'danger', time: '午前中' },
      { id: 't3', title: '未請求3件 担当確認・依頼', category: '請求', alertLevel: 'warning', time: '午前' },
      { id: 't4', title: 'B工務店 支払督促連絡', category: '回収', alertLevel: 'warning', time: '午後' },
      { id: 't5', title: '来週人員不足 協力業者連絡', category: '現場', time: '夕方' },
    ],
  },
  {
    period: 'tomorrow',
    label: '明日',
    events: [
      { id: 'tm1', title: '人員手配 最終確認', category: '現場', time: '09:00' },
      { id: 'tm2', title: '銀行回答待ち（融資審査進捗）', category: '銀行', time: '随時' },
      { id: 'tm3', title: '○○建設 追客電話（見積提出21日超過）', category: '営業', alertLevel: 'warning', time: '午前' },
      { id: 'tm4', title: '月次損益確認（工務部・営業部）', category: '経営', time: '午後' },
    ],
  },
  {
    period: 'this-week',
    label: '今週',
    events: [
      { id: 'w1', title: '未請求3件 請求書発行完了', category: '請求', alertLevel: 'warning' },
      { id: 'w2', title: '事故対応 保険会社との調整', category: '事故', alertLevel: 'warning' },
      { id: 'w3', title: '資金繰り表 7月〜9月分更新', category: '経営' },
      { id: 'w4', title: 'B工務店 入金確認', category: '回収' },
      { id: 'w5', title: '来週3現場の人員配置 確定', category: '現場' },
    ],
  },
  {
    period: 'next-week',
    label: '来週',
    events: [
      { id: 'nw1', title: '3現場 同時稼働スタート', category: '現場' },
      { id: 'nw2', title: '処遇改善加算 7月分書類準備（みらい）', category: '福祉', alertLevel: 'warning' },
      { id: 'nw3', title: '銀行融資 審査結果見込み', category: '銀行' },
      { id: 'nw4', title: '○○建設 提案フォロー', category: '営業' },
    ],
  },
  {
    period: 'this-month',
    label: '今月',
    events: [
      { id: 'm1', title: '月次決算 粗利確認（28.6%）', category: '経営' },
      { id: 'm2', title: '未請求¥6.8M 全件入金確認', category: '請求' },
      { id: 'm3', title: '事故案件 完全クローズ', category: '事故' },
      { id: 'm4', title: '銀行融資 最終回答受領', category: '銀行' },
      { id: 'm5', title: 'ケアプラン更新2件（みらい 6/30期限）', category: '福祉', alertLevel: 'danger' },
    ],
  },
]

// ── Phase 3: AI判断一言 ────────────────────────────────────
export const aiJudgement: AiJudgement = {
  message:
    '坂本社長、今日は「銀行資料（17時締切）」と「事故対応報告」を最優先で処理してください。未請求¥6.8Mは本日中に経理へ依頼を出すだけで構いません。午後に時間が取れる場合は、B工務店への督促連絡も入れてください。',
  focusItems: ['銀行資料提出（17時厳守）', '事故対応・顧客報告', '未請求3件 経理へ依頼'],
  generatedAt: '2026-06-26 07:30',
}

// ── Phase 3: 検索インデックス（仮データ） ──────────────────
export const searchIndex: SearchResult[] = [
  // 人
  { id: 's-p1', category: '人', title: '田中 誠', sub: '田中建設 部長 / 取引先', alertLevel: undefined },
  { id: 's-p2', category: '人', title: '加藤 健一', sub: '現場監督 / LCC従業員', alertLevel: undefined },
  { id: 's-p3', category: '人', title: '佐藤 真一', sub: '三菱UFJ銀行 担当者', alertLevel: 'warning' },
  { id: 's-p4', category: '人', title: '山田 哲也', sub: '外注 / 左官工', alertLevel: undefined },
  // 案件
  { id: 's-pr1', category: '案件', title: '○○リフォーム工事', sub: '進行中 / 事故発生中', alertLevel: 'danger' },
  { id: 's-pr2', category: '案件', title: '△△ビル修繕', sub: '進行中 / 資材搬入待ち', alertLevel: 'warning' },
  { id: 's-pr3', category: '案件', title: '□□外構工事', sub: '完了 / 未請求¥1.6M', alertLevel: 'warning' },
  { id: 's-pr4', category: '案件', title: '○○建設 新築外構', sub: '提案中 / 21日経過', alertLevel: 'warning' },
  // 連絡
  { id: 's-c1', category: '連絡', title: '三菱UFJ銀行 追加資料要請', sub: '6/25受信 / 本日17時期限', alertLevel: 'danger' },
  { id: 's-c2', category: '連絡', title: 'B工務店 未払い督促', sub: '¥1,800,000 / 期限超過14日', alertLevel: 'warning' },
  { id: 's-c3', category: '連絡', title: '鈴木様 見積依頼', sub: '6/19受信 / 未回答7日', alertLevel: undefined },
  // 書類
  { id: 's-d1', category: '書類', title: '事業計画書（最新版）', sub: '2026年6月 / Drive未連携', alertLevel: undefined },
  { id: 's-d2', category: '書類', title: '試算表 6月期', sub: 'freee未連携 / 作成予定', alertLevel: undefined },
  { id: 's-d3', category: '書類', title: '○○工事 請求書未発行', sub: '¥2,800,000 / 至急', alertLevel: 'warning' },
  // 予定
  { id: 's-e1', category: '予定', title: '銀行資料提出期限', sub: '本日17:00 / 厳守', alertLevel: 'danger' },
  { id: 's-e2', category: '予定', title: '来週月曜 3現場スタート', sub: '人員確定要', alertLevel: 'warning' },
  // タスク
  { id: 's-t1', category: 'タスク', title: '未請求3件 請求書発行依頼', sub: '経理担当 / 今週中', alertLevel: 'warning' },
  { id: 's-t2', category: 'タスク', title: '事故 保険会社連絡', sub: '本日中', alertLevel: 'danger' },
]
