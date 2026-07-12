# DRIVE_READONLY_DESIGN.md — Google Drive ReadOnly 設計書

> Phase 7 — v0.7.0（2026-06-27）  
> 許可スコープ: `drive.readonly` のみ。書き込み処理は一切実装しない。

---

## 目的

Google Drive を読み取り専用で接続し、AI社長室の File Provider にファイル情報を流し込む。  
Inbox Provider（Gmail）・Schedule Provider（Calendar）と合わせ、三元横断分析を実現する。

---

## スコープ設計

| スコープ | 用途 | 実装状態 |
|---------|------|---------|
| `drive.readonly` | ファイル一覧取得・メタデータ取得 | ✅ Phase 7 追加 |
| `drive` | フルアクセス | ❌ 禁止（FORBIDDEN_SCOPES に追加） |
| `drive.file` | アプリ作成ファイルへのアクセス | ❌ 禁止 |
| `drive.appdata` | アプリデータフォルダ | ❌ 禁止 |

```typescript
// googleScopes.ts
export const PHASE7_SCOPES: GoogleScope[] = [
  GOOGLE_SCOPES.GMAIL_READONLY,
  GOOGLE_SCOPES.CALENDAR_READONLY,
  GOOGLE_SCOPES.DRIVE_READONLY,   // Phase 7 追加
]
```

---

## サービス層アーキテクチャ

```
Google Drive API (GET /drive/v3/files)
        ↓
  driveFetcher.ts     — GET 専用。書き込みメソッドはコード上に存在しない。
        ↓
  driveClient.ts      — mock / cache / api を切り替える入口
        ↓
  driveMapper.ts      — GoogleDriveFile → DriveDerivedFile → UnifiedFileItem
        ↓
  fileProvider.ts     — Provider 抽象層への接続
        ↓
  AI Engine           — priorityEngine / briefingEngine / searchEngine
        ↓
  画面                — CockpitScreen / Home / AiChat
```

---

## ファイルカテゴリ（10分類）

| カテゴリ | キーワード例 | 重要度デフォルト |
|---------|-----------|--------------|
| 銀行 | 銀行・信金・融資・金融・東京信 | A |
| 契約 | 契約・協定・覚書・合意・契約書 | A |
| 請求 | 請求・未請求・未払い・支払・請求書 | A |
| 見積 | 見積・見積書・提案・クオート | B |
| 現場 | 現場・施工・工事・竣工・作業 | B |
| 事故 | 事故・報告書・ヒヤリ・インシデント | A |
| 福祉 | 福祉・介護・障害・サービス計画 | B |
| 監査 | 監査・TKC・決算・税務・申告 | A |
| 資金繰り | 資金・キャッシュ・CF・繰り | A |
| 車両 | 車両・自動車・ドライブレコーダー | B |
| その他 | — | C |

---

## UnifiedFileItem 型（Phase 7 拡張）

```typescript
export interface UnifiedFileItem {
  id: string
  source: string
  providerType: 'file'
  name: string
  mimeType: string
  fileType: string              // PDF / Excel / Word / スプレッドシート 等
  webViewLink: string | null
  createdAt: string
  modifiedAt: string
  ownerName: string | null
  /** @deprecated use ownerName */ owner: string | null
  folderName: string | null
  category: string              // DriveFileCategory
  relatedCompany: string | null
  relatedPerson: string | null
  relatedProject: string | null
  importance: 'A' | 'B' | 'C'
  alertLevel: 'danger' | 'warning' | 'info' | null
  riskFlag: boolean
  suggestedAction: string | null
  readOnly: true                // 常に true（const として固定）
  writeEnabled: false           // 常に false（const として固定）
}
```

---

## AI Engine 連携

### priorityEngine — Inbox × File 横断スコアリング

```
同カテゴリのファイルあり（file.category === item.taskType）: +15
riskFlag ありのファイルあり: +10
```

### briefingEngine — 三元横断アクション生成

- イベント + 関連メール + 関連ファイル →「X時イベントは、メールと「ファイル名」が関連 → 先に資料確認」
- イベント + 関連ファイル →「イベントの関連資料「ファイル名」を事前確認」
- イベント + 関連メール → 既存の Phase 6 ロジック継続

### searchEngine — 横断検索

```typescript
export interface SearchResults {
  inbox: UnifiedInboxItem[]
  files: UnifiedFileItem[]
  totalCount: number
}

searchEngine.searchAll(query, inbox, files): SearchResults
```

---

## キャッシュ設計

| 項目 | 値 |
|-----|---|
| キャッシュキー | `drive_file_cache` / `drive_cache_at` |
| TTL | 5分（gmailCache / calendarCache と同一） |
| 保存先 | localStorage（クライアントのみ） |
| 外部送信 | なし |

---

## driveClient の動作フロー

```
driveClient.fetchFiles()
  ├─ googleToken.hasToken() === false
  │     → mockDriveFiles を返す（source: 'mock'）
  ├─ driveCache.get() が有効（5分以内）
  │     → キャッシュを返す（source: 'cache'）
  └─ API 呼び出し
        ├─ 成功 → driveCache.set() してAPIデータを返す（source: 'api'）
        └─ 失敗 → stale キャッシュ or mock にフォールバック
```

---

## 書き込み禁止の設計方針

`driveFetcher.ts` には GET メソッドのみを実装する。  
以下の関数はコード上に存在しない（コメントのみで明示）：

- `createFile` / `updateFile` / `deleteFile` / `moveFile`
- `shareFile` / `changePermission` / `createFolder`
- `uploadFile` / `copyFile` / `addComment`

```typescript
// driveFetcher.ts（抜粋）
export async function fetchDriveFiles(accessToken: string): Promise<GoogleDriveFile[]> {
  // GET /drive/v3/files のみ実装
  // createFile / updateFile / deleteFile / 書き込みAPI は完全未実装
}
```

---

## デモデータ（mockDrive.ts）

| ファイル名 | カテゴリ | 重要度 | リスク |
|----------|---------|------|------|
| 銀行提出資料_追加依頼_東京信金.xlsx | 銀行 | A | あり |
| 工事契約書_〇〇邸_2026年06月.pdf | 契約 | A | あり |
| 未請求一覧_6月_お結び.xlsx | 請求 | A | あり |
| お結び監査対応資料_TKC_2026上期.pdf | 監査 | A | あり |
| 車両事故報告書_〇〇車_2026-06-20.pdf | 事故 | A | あり |
| 資金繰り表_2026年06月.xlsx | 資金繰り | A | あり |
| 見積書_〇〇社_2026-06.pdf | 見積 | B | なし |

---

## 次フェーズ予定

| フェーズ | 内容 |
|---------|------|
| Phase 8 | Google Sheets ReadOnly / BusinessData Provider 接続 |
| 将来（未定） | Drive ファイルプレビュー（読み取り専用・ダウンロード不可） |
| 永久禁止 | Drive への書き込み・削除・権限変更・共有設定変更 |
