# DATA_FLOW.md — データの流れ

> 最終更新: Phase 10 — v1.0.0（2026-06-27）

---

## Phase 10 追加: AI Orchestrator 統合データフロー

```
────────── AI Orchestrator 統合フロー（aiOrchestrator.ts）──────────

mockGmailMessages → gmailMapper → inboxProvider
mockLineWorksInboxMessages → lineworksMapper ─────────┐
                                                       │
mockCalendarEvents → calendarMapper → scheduleItems   │
                                                       │
mockDriveFiles → driveMapper → fileItems              ├──→ AI Engine処理
                                                       │
mockBusinessDataset.metrics → businessMetrics         │
                                                       │
mockLineWorksNotifications → lineworksMapper → notifs ┘

            ↓ AI Engine処理

  1. buildCrossProviderContexts()  → CrossProviderContext[]
                                     （銀行/請求/事故/人員/現場テーマ）
  2. calculateCompanyHealth()      → CompanyHealthScore
                                     （9カテゴリ / グレードA〜D）
  3. detectNotificationRisks()     → UnifiedRisk[]
     detectBusinessRisks()         → UnifiedRisk[]（変換済）
  4. riskClusters（crossContexts×risks）
  5. buildDecisionList()           → DecisionItem[] TOP7
  6. buildApprovalQueue()          → ActionDraft[] 最大6件
  7. generateExecutiveBriefing()   → ExecutiveBriefing
  8. buildImmediateActions()       → DecisionItem[] TOP3
  
            ↓ OrchestratorResult

  { briefing, todayPlan, healthScore, risks, riskClusters,
    approvalQueue, crossContexts, generatedAt }

            ↓ useMemo（各画面）

  CockpitScreen → decisions / approvalQueue / healthScore / notifications
  TodayActions  → decisions / inbox / notifications
  AiChat        → orchestratorResult（全統合）
  Dashboard     → healthScore / metrics
  Home          → briefing / healthScore
```

---

## Phase 9 追加: LINE WORKS データフロー

```
─────────────── LINE WORKS 通知取得フロー ───────────────

lineworksClient.fetchNotifications()
  │
  ├── [デモ/未設定] → mockLineWorksNotifications（mockLineworks.ts 5件）
  │
  └── [VITE_LINEWORKS_BOT_ID 設定済み]
          │
          ├── lineworksCache.get() → キャッシュあり（5分以内）
          │         │
          │         ▼ LineWorksNotificationMessage[]（キャッシュ）
          │
          └── lineworksCache.isStale() = true
                    │
                    ▼
              lineworksFetcher.getMessages(channelId)
                    │ GET https://www.worksapis.com/v1.0/bots/{botId}/channels/{channelId}/messages
                    │ ← 読み取りのみ / 書き込みAPI呼び出しなし
                    ▼
              LineWorksNotificationMessage[]
                    │
                    ▼
              lineworksCache.set(data)

─────────────── LINE WORKS → UnifiedNotification フロー ───────────────

LineWorksNotificationMessage[]（mockLineworks.ts）
  │
  ├── lineworksMapper.buildNotificationTitle()  → 【緊急】/【要確認】プレフィックス付きタイトル
  ├── lineworksMapper.mapLineWorksToUnifiedNotification()
  └── notificationProvider.getItems()
        ↓
UnifiedNotification[]
  │ (readOnly: true, writeEnabled: false, urgency, category, riskFlag)
  │
  ├── CockpitScreen  — ティールセクション（緊急通知カード）
  ├── Home           — ティールLINE WORKSカード
  ├── TodayActions   — LINE WORKSセクション（通知5件）
  ├── AiChat         — LINE WORKSショートカットバー（6件）
  └── riskEngine.detectFromNotifications() → UnifiedRisk[]

─────────────── LINE WORKS → UnifiedInboxItem フロー ───────────────

LineWorksInboxMessage[]（mockLineworks.ts 4件）
  │
  └── lineworksMapper.mapLineWorksToUnifiedInboxItem()
        ↓
UnifiedInboxItem[]
  │ (readOnly: true, writeEnabled: false, source: 'LINE WORKS')
  │
  └── inboxProvider.getItems()
        → [...gmailItems, ...lwItems]  — Gmail + LINE WORKS 統合

─────────────── 書き込み禁止ガード ───────────────

lineworksFetcher.sendMessage()    → throw Error('WRITE_FORBIDDEN: sendMessage is not allowed')
lineworksFetcher.replyMessage()   → throw Error('WRITE_FORBIDDEN')
lineworksFetcher.markAsRead()     → throw Error('WRITE_FORBIDDEN')
lineworksFetcher.deleteMessage()  → throw Error('WRITE_FORBIDDEN')
lineworksFetcher.postToChannel()  → throw Error('WRITE_FORBIDDEN')
... (計10メソッド全て WRITE_FORBIDDEN)
```

---

## Phase 6 追加: Calendar データフロー

```
─────────────── Calendar 取得フロー ───────────────

calendarClient.fetchEvents()
  │
  ├── [未認証] → mockCalendarEvents（mockCalendar.ts）
  │
  └── [認証済み]
          │
          ├── calendarCache.get() → キャッシュあり（5分以内）
          │         │
          │         ▼ GoogleCalendarEvent[]（キャッシュ）
          │
          └── calendarCache.isStale() = true
                    │
                    ▼
              googleToken.getOrThrow()
                    │
                    ▼
              calendarFetcher.fetchCalendarEvents(accessToken)
                    │ GET /calendar/v3/calendars/primary/events
                    │   ?timeMin=今日00:00 &timeMax=7日後 &singleEvents=true
                    ▼
              GoogleCalendarEvent[]
                    │
                    ▼
              calendarCache.set(events)

─────────────── Calendar → UnifiedScheduleItem フロー ───────────────

GoogleCalendarEvent[]
  │
  ├── calendarAnalyzer.analyzeCategory()   → '銀行'|'面談'|'会議'|'現場'|...
  ├── calendarAnalyzer.analyzeImportance() → 'A'|'B'|'C'
  ├── calendarAnalyzer.hasDeadlineRisk()   → boolean
  ├── calendarAnalyzer.suggestAction()     → string|null
  └── calendarMapper.mapToCalendarDerivedEvent()
        ↓ CalendarDerivedEvent
        ↓ calendarMapper.mapCalendarDerivedEventToUnifiedScheduleItem()
        ↓
UnifiedScheduleItem[]
  │ (readOnly: true, writeEnabled: false)
  ├── scheduleProvider.getItems()
  │       ↓
  │   CockpitScreen.tsx (今日の予定セクション)
  │   Home.tsx          (今日の予定カード)
  │   AiChat.tsx        (カレンダーショートカット回答)
  │
  └── AI Engine へ
          │
          ├── priorityEngine.rankItems(inbox, schedule)   ← 横断スコアリング
          ├── briefingEngine.generateSections(inbox, risks, schedule)
          └── priorityEngine.getCrossServiceTopItems(inbox, schedule, risks)

─────────────── Inbox × Schedule 横断フロー ───────────────

UnifiedInboxItem[] (Gmail)
  + UnifiedScheduleItem[] (Calendar)
      │
      ▼ priorityEngine.scoreInboxItem(item, schedule)
      │   → Gmailタスクタイプ === Calendar カテゴリ → +20
      │   → 関連予定が最重要(A) → +10
      │
      ▼ briefingEngine.generateCrossItems(inbox, schedule)
      │   → 「10:00 銀行打合せは、追加資料依頼と関連 → 先に資料確認」
      │
      ▼ AIコックピット / ホーム / AI相談 に反映
```

---

## Phase 5.5 追加: Provider / AI Engine データフロー

```
─────────────── Provider層データフロー ───────────────

mockGmailMessages（mockGmail.ts）
  │
  ▼ inboxProvider.getItems()
  │   mapToGmailDerivedTask() [gmailMapper.ts]
  │   → mapGmailDerivedTaskToUnifiedInboxItem()
  ▼
UnifiedInboxItem[]
  │
  ├── providerRegistry.getInboxItems()
  │       ↓ Settings.tsx の AI社長室データ基盤カード
  │
  └── AI Engine へ（将来）
          │
          ├── normalizer.gmailToInboxItem()
          ├── priorityEngine.rankItems()
          ├── riskEngine.detectFromInbox()
          ├── briefingEngine.generateSections()
          ├── actionEngine.suggestFromInbox()
          └── searchEngine.search()

─────────────── Provider健全性フロー ───────────────

providerRegistry.getAllDescriptors()
  │ 全6 Provider の getDescriptor() を呼び出す
  │   inboxProvider.getDescriptor()
  │     → googleToken.hasToken() で connectionStatus を決定
  │   scheduleProvider / fileProvider / businessDataProvider
  │   workflowProvider / notificationProvider
  │     → connectionStatus: 'planned'（固定）
  │
  ▼
ProviderDescriptor[]
  │
  ▼ providerHealth.getSummary()
  │   connected: 1（Gmailのみ、認証なしなら0）
  │   planned: 5
  │   total: 6
  │   overallHealth: 'degraded'（inbox未接続時）or 'healthy'
  │
  ▼ Settings.tsx の AI社長室データ基盤カード
      全体健全性バッジ + Provider一覧行

─────────────── 承認ゲートフロー（将来） ───────────────

actionEngine.suggestFromInbox(items)
  │ → UnifiedActionSuggestion { requiresApproval: true, writeEnabled: false }
  ▼
approvalEngine.createApprovalRequest(suggestion, 'Gmail')
  │ → UnifiedApprovalRequest { status: 'pending' }
  ▼
社長承認（将来: 承認UI実装後）
  │ → status: 'approved'
  ▼
approvalEngine.canExecute(request) === true
  └ 外部APIへの書き込みが解放される（将来フェーズ実装）
```

---

## Gmail データフロー（全体）

```
─────────────── 認証フロー ───────────────

Google OAuth
  │ Authorization Code + PKCE
  ▼
googleAuth.ts
  │ handleCallback(code, state)
  │ → POST https://oauth2.googleapis.com/token
  │ → access_token, refresh_token 取得
  ▼
googleToken.ts
  │ save(tokens, email)
  ▼
googleStorage.ts
  │ localStorage に保存
  │ gauth_access_token
  │ gauth_refresh_token
  │ gauth_token_expiry
  │ gauth_token_scope
  │ gauth_connected_email

─────────────── データ取得フロー ───────────────

gmailClient.fetchRawMessages()
  │
  ├── [未認証] → mockGmailMessages（mockGmail.ts）
  │
  └── [認証済み]
          │
          ├── gmailCache.get() → キャッシュあり（5分以内）
          │         │ キャッシュヒット
          │         ▼
          │     GmailMessage[] （キャッシュ）
          │
          └── gmailCache.isStale() = true
                    │
                    ▼
              googleToken.getOrThrow()
                    │ access_token 取得
                    ▼
              gmailFetcher.fetchMessages(accessToken)
                    │ GET /gmail/v1/users/me/messages?q=is:unread newer_than:3d
                    │ GET /gmail/v1/users/me/messages/{id}?format=full （並列10件）
                    ▼
              GmailMessage[] （実データ）
                    │
                    ▼
              gmailCache.set(messages)
                    │ localStorage に保存
                    ▼
              GmailMessage[]

─────────────── 分析・変換フロー ───────────────

GmailMessage[]
  │
  ├── gmailAnalyzer.ts
  │       ├── analyzeTaskType()   → 銀行/請求/契約/事故/営業/福祉/その他
  │       ├── analyzePriority()   → A / B / C
  │       ├── extractDeadline()   → 本日中 / 今日中 / 至急 etc.
  │       └── createGmailSummary() → GmailSummary（件数集計）
  │
  ├── gmailMapper.ts
  │       └── mapToGmailDerivedTask() → GmailDerivedTask
  │
  └── briefingGenerator.ts
          └── generateBriefingFromMessages() → GeneratedBriefing

─────────────── 画面表示フロー ───────────────

GmailMessage[] / GmailDerivedTask[] / GmailSummary
  │
  ├── Home.tsx
  │       └── GmailSummary → Gmail要対応サマリーカード
  │           （件数チップ: 重要A/本日中/銀行/請求/契約/返信たたき台）
  │
  ├── CockpitScreen.tsx
  │       └── GmailSummary + GmailDerivedTask[] → Gmailセクション
  │           （件数内訳 + TOP3詳細 + 優先度バッジ）
  │
  ├── TodayActions.tsx
  │       └── GmailDerivedTask[] → Gmailタスクカード
  │           → モーダル（返信文・推奨アクション・安全通知）
  │
  ├── AiChat.tsx
  │       └── mockData.ts の secretary responses（Gmail回答）
  │           （将来: GmailMessage[] から動的生成予定）
  │
  └── Settings.tsx
          ├── GmailSummary → Gmail読み取りテスト結果
          └── googleSession.get() → Google接続カード状態
```

---

## 認証ログフロー

```
googleStorage.appendLog(entry)
  │ event: oauth_start / oauth_success / oauth_error
  │        token_refresh / fetch_start / fetch_success / fetch_error / disconnect
  │ timestamp: ISO 8601
  │ detail: 詳細テキスト
  ▼
localStorage["gauth_log"]
  │ 最大50件（FIFO）
  ▼
googleSession.get().recentLogs (最新10件)
  ▼
Settings.tsx 認証ログ表示（折りたたみ）
```

---

## キャッシュフロー

```
gmailCache.get()
  │
  ├── localStorage["gmail_msg_cache"] なし → null（キャッシュミス）
  ├── localStorage["gmail_cache_at"] から経過時間計算
  │   5分以上経過 → null（期限切れ）
  └── 5分以内 → GmailMessage[]（キャッシュヒット）

gmailCache.set(messages)
  │
  └── JSON.stringify → localStorage["gmail_msg_cache"]
      Date.now() → localStorage["gmail_cache_at"]

gmailCache.clear()
  └── localStorage から削除（手動リフレッシュ / 切断時）
```

---

## mockData フロー（未接続時）

```
client/src/data/mockData.ts
  │
  ├── actionItems → TodayActions.tsx（通常タスク）
  ├── todayBriefing → Home.tsx（AIブリーフィング）
  ├── situationCards → Home.tsx（状況カード）
  ├── dashboardMetrics → Dashboard.tsx
  ├── companyHealthScore → CockpitScreen.tsx
  ├── priorityActions → CockpitScreen.tsx
  └── secretaryResponses → AiChat.tsx（キーワード応答）

client/src/services/gmail/mockGmail.ts
  │ 5件のデモメール（銀行/請求/監督署/契約/外注費）
  │
  └── [未認証時] gmailClient.fetchRawMessages() が返す
```

---

## セッション状態フロー

```
googleSession.ts
  │
  ├── .get() → localStorage を読んで GoogleSession を構築
  │   status: 'disconnected' | 'connecting' | 'connected' | 'error'
  │   connectedEmail: string | null
  │   grantedScopes: string[]
  │   recentLogs: AuthLogEntry[]
  │
  ├── .setConnecting() → localStorage["gauth_status"] = 'connecting'
  ├── .setConnected() → localStorage["gauth_status"] = 'connected'
  ├── .setError(msg) → localStorage["gauth_status"] = 'error'
  └── .clear() → localStorage から status・error を削除

Settings.tsx
  │ const [gSession, setGSession] = useState(googleSession.get())
  │ useEffect(() => setGSession(googleSession.get()), [])
  └── Google接続カード描画
```

---

## データ書き込み禁止の確認

```
gmailFetcher.ts
  │ fetchMessages(accessToken)
  │   ↓ GET /gmail/v1/users/me/messages   ← 読み取りのみ
  │   ↓ GET /gmail/v1/users/me/messages/{id} ← 読み取りのみ
  └── GmailMessage[] を返すだけ。POST/PUT/PATCH/DELETE はなし。
```
