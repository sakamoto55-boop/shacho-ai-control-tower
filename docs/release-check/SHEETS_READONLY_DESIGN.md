# SHEETS_READONLY_DESIGN.md — Google Sheets ReadOnly 設計書

> Phase 8 — v0.8.0（2026-06-27）  
> 許可スコープ: `spreadsheets.readonly` のみ。書き込み処理は一切実装しない。

---

## 目的

Google Sheets を読み取り専用で接続し、AI社長室の BusinessData Provider に経営数字を流し込む。  
Inbox Provider（Gmail）・Schedule Provider（Calendar）・File Provider（Drive）と合わせ、四元横断分析を実現する。

---

## スコープ設計

| スコープ | 用途 | 実装状態 |
|---------|------|---------|
| `spreadsheets.readonly` | スプレッドシート読み取り・値取得 | ✅ Phase 8 追加 |
| `spreadsheets` | フルアクセス | ❌ 禁止（FORBIDDEN_SCOPES に追加済） |
| `drive` | Drive フルアクセス | ❌ 禁止 |

---

## サービス層アーキテクチャ

```
Google Sheets API (GET /spreadsheets/{id}/values/{range})
        ↓
  sheetsFetcher.ts     — GET 専用。書き込みメソッドはコード上に存在しない。
        ↓
  sheetsClient.ts      — mock / cache / api を切り替える入口
        ↓
  sheetsMapper.ts      — SheetRow → UnifiedBusinessMetric → UnifiedBusinessDataset
        ↓
  businessDataProvider.ts — Provider 抽象層への接続
        ↓
  AI Engine            — priorityEngine / briefingEngine / riskEngine / searchEngine
        ↓
  画面                 — CockpitScreen / Home / Dashboard / AiChat
```

---

## 経営指標（8指標）

| 指標 | metricKey | カテゴリ | デモ値 | 状態 |
|-----|-----------|---------|-------|------|
| 今月売上 | monthly_revenue | 売上 | ¥2,840万 | normal |
| 今月粗利 | monthly_gross_profit | 粗利 | ¥810万 | normal |
| 今月粗利率 | gross_profit_rate | 粗利 | 28.5% | warning |
| 現金残高 | cash_balance | 資金繰り | ¥420万 | warning |
| 未請求 | unbilled | 請求 | ¥680万 | danger |
| 未回収 | uncollected | 未回収 | ¥320万 | warning |
| 事故件数 | accident_count | 事故 | 1件 | danger |
| 社員稼働率 | utilization_rate | 稼働率 | 87% | warning |

---

## AI Engine 連携（四元横断分析）

### priorityEngine — Inbox × BusinessData 横断スコアリング

```
未請求 danger + 請求メール: +20
資金繰り warning + 銀行メール: +15
事故件数 > 0 + 事故メール: +25
```

### briefingEngine — 四元横断アクション生成

- イベント + メール + ファイル + 経営数字 → 「X時イベントは、関連資料・売上データを事前確認」
- 未請求危険 → 「未請求¥680万超 — 請求処理を優先」

### searchEngine — 四元横断検索

```typescript
searchAll(query, inbox, files, metrics): SearchResults
// { inbox, files, metrics, totalCount }
```

---

## キャッシュ設計

| 項目 | 値 |
|-----|---|
| キャッシュキー | `sheets_dataset_cache` / `sheets_cache_at` |
| TTL | 5分（gmailCache / calendarCache / driveCache と同一） |
| 保存先 | localStorage（クライアントのみ） |

---

## 書き込み禁止の設計方針

`sheetsFetcher.ts` には GET メソッドのみを実装する。  
以下の関数はコード上に存在しない：

- `createSpreadsheet` / `updateValues` / `appendValues` / `batchUpdate`
- `deleteSheet` / `addSheet` / `deleteRows` / `updateCellFormat`
- `shareSpreadsheet` / `changePermission`

---

## 次フェーズ予定

| フェーズ | 内容 |
|---------|------|
| Phase 9 | LINE WORKS / Notification Provider 接続 |
| 永久禁止 | Sheets への書き込み・削除・権限変更・共有設定変更 |
