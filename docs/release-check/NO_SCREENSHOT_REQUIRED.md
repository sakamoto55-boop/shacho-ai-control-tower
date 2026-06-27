# NO_SCREENSHOT_REQUIRED.md — スクリーンショット不要の検収フロー

> このファイルは、スクリーンショットなしで変更点と安全性を確認できることを明記します。  
> 最終更新: Phase 9 — v0.9.0（2026-06-27）

---

## 方針

各フェーズ完了時に `docs/release-check/` 配下のファイルを更新することで、  
スクリーンショットなしで以下が確認できます。

---

## 各検収ファイルで確認できること

| ファイル | 確認できる内容 |
|---------|-------------|
| `CHANGELOG_PHASE.md` | フェーズで何を追加・変更・削除したか |
| `FILES_CHANGED.md` | どのファイルが変更されたか（追加/更新/削除） |
| `IMPLEMENTATION_REPORT.md` | 実装済み項目・未実装項目・注意点の一覧 |
| `SAFETY_REPORT.md` | 外部API接続状況・スコープ・書き込み処理の有無 |
| `SCREEN_LIST.md` | どの画面が変わったか・何が表示されるか |
| `TEST_CHECKLIST.md` | 手動で確認すべきチェックリスト |
| `ROUTE_MAP.md` | 画面遷移の全体像・OAuth フロー |
| `DATA_FLOW.md` | データがどこから来てどこへ行くか |
| `OAUTH_SECURITY_REVIEW.md` | OAuth安全設計・SPA リスク・本番化前注意事項（Phase 5.1追加） |
| `GOOGLE_CONNECT_CHECKLIST.md` | Google Cloud Console 設定手順（Phase 5.1追加） |
| `ARCHITECTURE_OVERVIEW.md` | AI社長室4層アーキテクチャ概要・設計原則（Phase 5.5追加） |
| `PROVIDER_DESIGN.md` | Provider一覧・インターフェース・Unified型・追加手順（Phase 5.5追加） |
| `AI_ENGINE_DESIGN.md` | AI Engine各エンジン入出力・承認ゲート設計（Phase 5.5追加） |
| `CALENDAR_READONLY_DESIGN.md` | Google Calendar ReadOnly 設計・フロー・書き込み禁止確認（Phase 6追加） |
| `DRIVE_READONLY_DESIGN.md` | Google Drive ReadOnly 設計・カテゴリ・三元横断分析・書き込み禁止確認（Phase 7追加） |
| `SHEETS_READONLY_DESIGN.md` | Google Sheets ReadOnly 設計・経営指標・四元横断分析・書き込み禁止確認（Phase 8追加） |
| `LINEWORKS_NOTIFICATION_DESIGN.md` | LINE WORKS Notification Provider設計・禁止操作・モックデータ・セキュリティ注意事項（Phase 9追加） |

---

## スクリーンショットの代替確認方法

### 画面内容の確認
→ `SCREEN_LIST.md` の「各画面別想定表示内容チェック」を参照  
各画面で何が表示されるべきかが記載されています。

### 安全性の確認
→ `SAFETY_REPORT.md` を参照  
外部API接続の有無、スコープ、書き込みAPI実装状況が一覧化されています。

### 実装漏れの確認
→ `IMPLEMENTATION_REPORT.md` の「未実装項目」を参照  
意図的に保留している項目と理由が明記されています。

### データの流れの確認
→ `DATA_FLOW.md` を参照  
mockGmail / 本番API / キャッシュ / 画面表示の流れが図で確認できます。

### 変更ファイルの確認
→ `FILES_CHANGED.md` を参照  
どのファイルが変更されたかと、その役割が一覧化されています。

---

## ビルド・型チェックによる自動検証

スクリーンショットの代わりに、以下が保証されています:

```bash
# TypeScript 型チェック + Vite ビルド（エラーなし）
cd client && npm run build
```

- TypeScript の strict モードで型安全性を確認
- 未使用の import・変数がエラーになる（`noUnusedLocals`, `noUnusedParameters`）
- ビルド成功 = コンパイルエラーなし・バンドルサイズ正常

---

## 今後のフェーズでの運用ルール

1. **各フェーズ完了時に必ず `docs/release-check/` を更新する**
2. **外部API接続を追加した場合は `SAFETY_REPORT.md` を最初に更新する**
3. **書き込み処理を実装した場合（将来フェーズ）は `SAFETY_REPORT.md` の禁止一覧から削除して別欄に移動する**
4. **スクリーンショットは任意。検収ファイルで代替する。**
5. **提出物は以下に統一する:**

```
・GitHub URL（ブランチ名 + コミットハッシュ）
・公開URL（デプロイがある場合）
・docs/release-check/ 配下のファイル更新有無
・変更ファイル一覧（FILES_CHANGED.md）
・SAFETY_REPORT.md の要約（接続先・スコープ・書き込み有無）
・未実装項目（IMPLEMENTATION_REPORT.md）
```
