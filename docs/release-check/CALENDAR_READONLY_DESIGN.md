# CALENDAR_READONLY_DESIGN.md — Google Calendar ReadOnly 設計書

> Phase 6 — v0.6.0（2026-06-27）
> このドキュメントは Google Calendar ReadOnly 接続の設計・フロー・書き込み禁止確認を記載します。

---

## 設計方針

| 方針 | 内容 |
|------|------|
| 取得スコープ | `calendar.readonly` のみ |
| 書き込み禁止 | createEvent / updateEvent / deleteEvent / respondEvent / attendeeModify 未実装 |
| データ源 | 認証なし → mockCalendar。認証済み → Google Calendar API |
| キャッシュ | 5分 TTL（gmailCache と同設計） |
| Unified変換 | UnifiedScheduleItem（readOnly: true / writeEnabled: false 固定） |

---

## Calendar サービス層構成

```
client/src/services/calendar/
├── types.ts           GoogleCalendarEvent / CalendarDerivedEvent / CalendarSummary 型
├── mockCalendar.ts    デモ予定データ（銀行・現場・行政・運営確認・締切 5件）
├── calendarClient.ts  ReadOnly 入口（mock/cache/api 切り替え）
├── calendarFetcher.ts GET 専用フェッチャー
├── calendarMapper.ts  GoogleCalendarEvent → CalendarDerivedEvent → UnifiedScheduleItem
├── calendarAnalyzer.ts 重要度・カテゴリ・期限リスク・推奨アクション・CalendarSummary
└── calendarCache.ts   ローカルキャッシュ（5分 TTL）
```

---

## calendarFetcher.ts — 書き込み禁止の確認

```typescript
// fetchCalendarEvents(accessToken): Promise<GoogleCalendarEvent[]>
// GET /calendar/v3/calendars/primary/events のみ

// 未実装（書き込み禁止）:
//   createEvent   — 未実装
//   updateEvent   — 未実装
//   deleteEvent   — 未実装
//   respondEvent  — 未実装
//   attendeeModify — 未実装
```

HTTP メソッド使用状況:

| ファイル | GET | POST | PATCH | PUT | DELETE |
|---------|-----|------|-------|-----|--------|
| `calendarFetcher.ts` | ✅ | ❌ | ❌ | ❌ | ❌ |

---

## UnifiedScheduleItem フィールド定義（Phase 6 拡張版）

| フィールド | 型 | 説明 |
|----------|-----|------|
| `id` | string | `calendar-{eventId}` 形式 |
| `source` | string | `'デモCalendar'` または `'Google Calendar'` |
| `providerType` | `'schedule'` | 固定 |
| `title` | string | イベントタイトル |
| `description` | string\|null | 説明文 |
| `startAt` | string | ISO 8601 |
| `endAt` | string\|null | ISO 8601 |
| `location` | string\|null | 場所 |
| `isAllDay` | boolean | 終日イベントかどうか |
| `attendees` | string[] | 参加者表示名リスト |
| `calendarName` | string | カレンダー名 |
| `priority` | `'A'|'B'|'C'` | 重要度（analyzeImportance 判定） |
| `alertLevel` | `'danger'|'warning'|'info'|null` | deadlineRisk→danger, 重要A→warning |
| `category` | string | 銀行/面談/会議/現場/行政/福祉/締切/支払/請求/監査/その他 |
| `relatedCompany` | string\|null | 関連会社・銀行名 |
| `relatedPerson` | string\|null | 関連担当者（attendees[0]） |
| `deadlineRisk` | boolean | 締切・提出・支払キーワードを含む |
| `suggestedAction` | string\|null | カテゴリ別推奨アクション |
| `readOnly` | `true` | 常に true |
| `writeEnabled` | `false` | 常に false |

---

## calendarAnalyzer.ts — カテゴリ判定キーワード

| カテゴリ | 判定キーワード |
|---------|-------------|
| 銀行 | 銀行, 信金, 信用, 融資, 口座, ファイナンス, 金融 |
| 面談 | 面談, 商談, ミーティング, 打合せ, 打ち合わせ, 相談 |
| 会議 | 会議, 会合, 運営, 定例 |
| 現場 | 現場, 施設, 工事, 確認, 点検, 巡回 |
| 行政 | 区役所, 市役所, 都庁, 行政, 補助金, 申請, 許認可, 監督署, 労基 |
| 福祉 | 介護, 福祉, 利用者, 訪問, デイ, ケア |
| 締切 | 締切, 締め切り, 期限, 提出, 最終 |
| 支払 | 支払, 振込, 決済, 精算 |
| 請求 | 請求, 請求書, インボイス, 外注費 |
| 監査 | 監査, 税務, 会計, 決算, TKC, freee |

重要度A判定キーワード: 銀行, 融資, 監査, 行政, 補助金, 締切, 期限, 至急, 緊急, 最終

---

## Schedule Provider — 接続状態

| 状態 | 条件 |
|------|------|
| connected | `googleToken.hasToken() === true` |
| disconnected | `googleToken.hasToken() === false` |
| planned | （なし、Phase 5.5 の stub は廃止） |

---

## Inbox × Schedule 横断分析（AI Engine）

### priorityEngine.ts

```
scoreInboxItem(item: UnifiedInboxItem, schedule: UnifiedScheduleItem[]): PriorityScore
  → Gmailタスクタイプ === Calendar カテゴリ → +20
  → 関連予定の priority === 'A' → さらに +10
```

### briefingEngine.ts

```
generateSections(inbox, risks, schedule):
  1. スケジュールセクション（最大5件）
  2. 受信トレイセクション（Priority A）
  3. リスクセクション
  4. 横断アクション（Inbox × Schedule 関連をテキスト化）

generateCrossItems(inbox, schedule):
  → 「10:00 銀行打合せは、追加資料依頼（山本支店長）と関連 → 先に資料確認」
```

---

## 使用スコープ

```
Phase 6 スコープ（PHASE6_SCOPES）:
  https://www.googleapis.com/auth/gmail.readonly
  https://www.googleapis.com/auth/calendar.readonly

絶対に使用してはいけないスコープ（FORBIDDEN_SCOPES）:
  https://www.googleapis.com/auth/gmail.modify
  https://www.googleapis.com/auth/gmail.send
  https://www.googleapis.com/auth/gmail.compose
  https://mail.google.com/
  https://www.googleapis.com/auth/calendar         ← 書き込み可能
  https://www.googleapis.com/auth/calendar.events  ← 書き込み可能
  https://www.googleapis.com/auth/drive
  https://www.googleapis.com/auth/spreadsheets
```

---

## 次フェーズ（Phase 7 予定）

- Google Drive ReadOnly / File Provider 接続
- スコープ: `drive.readonly`
- `fileProvider.ts` の stub を実装に差し替え
