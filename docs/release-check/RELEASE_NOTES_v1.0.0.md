# AI社長室 v1.0.0 リリースノート（2026-06-27）

> Phase 10 完了 — 全Provider横断 AI Engine統合 · 社長承認フロー · MVP完成

---

## 完成範囲

v1.0.0 は「社長が毎朝起動して今日の判断を行う」最小限の実用ラインに到達したバージョンです。  
外部APIへの書き込みは一切なし。全データはデモモックです。本番接続は Phase 11 以降。

---

## Phase 1〜10 要約

| Phase | テーマ | 主な完成物 |
|-------|--------|-----------|
| Phase 1 | 基盤構築 | React + TypeScript + Vite SPA · ナビゲーション5タブ |
| Phase 2 | Gmail読み取り設計 | GmailDerivedTask · GmailMapper · モックデータ |
| Phase 3 | AI優先度エンジン | PriorityEngine · BriefingEngine · RiskEngine |
| Phase 4 | ホーム・コックピット画面 | Home.tsx · CockpitScreen.tsx · ブリーフィングカード |
| Phase 5 | Provider抽象化 | Inbox/Schedule/File/BusinessData/Workflow/Notification Provider骨組み |
| Phase 5.1 | OAuth安全設計 | Google OAuth読み取り限定スコープ · WRITE_FORBIDDEN設計 |
| Phase 5.5 | AI Engine整備 | Normalizer / ApprovalEngine / SearchEngine / ActionEngine基盤 |
| Phase 6 | Google Calendar接続 | calendarFetcher · calendarMapper · Schedule Provider デモ接続 |
| Phase 7 | Google Drive接続 | driveFetcher · driveMapper · File Provider デモ接続 |
| Phase 8 | Google Sheets接続 | sheetsFetcher · sheetsMapper · BusinessData Provider デモ接続 |
| Phase 9 | LINE WORKS接続 | lineworksFetcher · Notification/Inbox Provider デモ接続 · 5画面更新 |
| Phase 10 | AI Engine統合 | crossProviderContext · companyHealthEngine · decisionEngine · actionDraftEngine · executiveBriefing · aiOrchestrator · 6画面更新 |

---

## 実装済みProvider（Phase 10時点）

| Provider | 接続状態 | データソース | readOnly |
|---------|---------|------------|---------|
| Inbox Provider | デモ接続 | Gmail（13件）+ LINE WORKS受信箱（4件）| true |
| Schedule Provider | デモ接続 | Google Calendar（デモ）| true |
| File Provider | デモ接続 | Google Drive（デモ）| true |
| BusinessData Provider | デモ接続 | Google Sheets（デモ）| true |
| Notification Provider | デモ接続 | LINE WORKS通知（5件）| true |

---

## 実装済みAI Engine（Phase 10 新規6本）

| エンジン | ファイル | 役割 |
|---------|---------|------|
| CrossProviderContext | `crossProviderContext.ts` | 全Provider横断コンテキスト生成 |
| CompanyHealthEngine | `companyHealthEngine.ts` | 会社健康スコア算出（9カテゴリ・グレードA〜D）|
| DecisionEngine | `decisionEngine.ts` | 社長の今日の優先判断リスト TOP7生成 |
| ActionDraftEngine | `actionDraftEngine.ts` | 社長承認用アクション下書き生成（最大6件）|
| ExecutiveBriefing | `executiveBriefing.ts` | 朝ブリーフィングテキスト生成 |
| AI Orchestrator | `aiOrchestrator.ts` | 全Providerデータ統合・AI Engine実行・OrchestratorResult返却 |

---

## 実装済み画面（6画面）

| 画面 | ファイル | Phase 10 主要追加 |
|------|---------|-----------------|
| ホーム | `Home.tsx` | （Phase 9 実装済み）|
| AIコックピット | `CockpitScreen.tsx` | AI優先アクション TOP5 · 社長承認キュー（amber）|
| 今日の要対応 | `TodayActions.tsx` | AI優先順タブ（emerald）· DecisionItem カード |
| AI相談 | `AiChat.tsx` | 統合ショートカットバー（indigo）· 8件ショートカット |
| 経営ダッシュボード | `Dashboard.tsx` | 会社健康度カード（9カテゴリグリッド）|
| 設定 | `Settings.tsx` | v1.0.0 · Phase 10 · 全Provider接続済み表示 |

---

## 安全設計（v1.0.0確定）

```
外部サービス → Provider → Unified型 → AI Engine → 画面表示
                                         ↓
                                  推奨アクション（提案のみ）
                                         ↓
                                  ActionDraft（表示のみ）
                                         ↓
                                  社長承認後 → Phase 11 実行フロー
```

| 制約 | 実装状態 |
|------|---------|
| 書き込みAPI実装なし | ✅ WRITE_FORBIDDEN パターン全サービスに適用 |
| readOnly: true | ✅ 全Provider・全Unified型に設定 |
| writeEnabled: false | ✅ 全Provider・全Unified型に設定 |
| externalSendDisabled: true | ✅ 全ActionDraftに設定 |
| saveDisabled: true | ✅ 全ActionDraftに設定 |
| 外部APIキー直書き禁止 | ✅ .env.example のみ。CLIENT_SECRET フロントエンド禁止 |

---

## 未実装項目（Phase 11以降）

- 本番OAuth認証（Google / LINE WORKS）
- バックエンドProxy（CLIENT_SECRET安全化）
- 社長承認後の外部実行（Gmail返信 · LINE WORKS送信）
- Webhook本番受信
- freee / TKC 経営数値連携
- Google Drive ファイル閲覧
- 承認フロー永続化・履歴

---

## Phase 11以降の方針

1. バックエンドProxy（Node.js/Cloud Run）を構築し CLIENT_SECRET を安全化
2. Google OAuth本番接続（Calendar + Gmail 読み取りのみ）
3. LINE WORKS OAuth本番接続（通知読み取りのみ）
4. 社長承認後の外部実行設計（書き込み範囲を最小化）
5. freee API 経営数値読み取り接続
