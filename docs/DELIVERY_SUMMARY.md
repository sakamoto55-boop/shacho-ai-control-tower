# AI社長室 v1.0.0 — 納品物一覧

> Phase 10.2 納品 · 2026-06-27

---

## 公開URL

| 項目 | 内容 |
|------|------|
| **公開URL** | `https://sakamoto55-boop.github.io/shacho-ai-control-tower/` |
| 有効化状態 | GitHub Pages 有効化後にアクセス可能 |
| 有効化手順 | リポジトリ Settings → Pages → Branch: gh-pages → / → Save |
| デプロイ元 | `gh-pages` ブランチ（静的ファイル: index.html + assets/） |

---

## GitHub リポジトリ

| 項目 | 内容 |
|------|------|
| リポジトリ | `sakamoto55-boop/shacho-ai-control-tower` |
| 開発ブランチ | `claude/ai-ceo-room-mobile-e7k8ye` |
| Phase 10 コミット | `8c90505` — feat(phase10): AI Engine統合 / 社長承認フロー |
| Phase 10.1 コミット | `9b267dd` — docs(phase10.1): v1.0.0 完成検収・凍結ドキュメント整備 |
| Phase 10.2 コミット | （このコミット — 納品物作成・デプロイ） |
| gh-pages コミット | `a810101` — deploy: AI社長室 v1.0.0 MVP — GitHub Pages |

---

## 納品ZIPファイル

| 項目 | 内容 |
|------|------|
| ファイル名 | `AI社長室_v1.0.0_MVP_納品版.zip` |
| 含まれるもの | ソースコード（client/src/）+ docs/ + README.md + 公開用ビルド（public/）|
| 除外 | node_modules / .git / .env |

---

## ドキュメント一覧

### 納品物ドキュメント（docs/）

| ファイル | 内容 |
|---------|------|
| [docs/HOW_TO_USE.md](HOW_TO_USE.md) | スマホでの使い方ガイド（初心者向け） |
| [docs/CURRENT_STATUS.md](CURRENT_STATUS.md) | 現在できること・できないことの一覧 |
| [docs/NEXT_SETUP_STEPS.md](NEXT_SETUP_STEPS.md) | 本番データへつなぐための手順（Phase 11 準備）|
| [docs/DELIVERY_SUMMARY.md](DELIVERY_SUMMARY.md) | 納品物一覧（このファイル）|

### 検収ドキュメント（docs/release-check/）

| ファイル | 内容 |
|---------|------|
| [RELEASE_NOTES_v1.0.0.md](release-check/RELEASE_NOTES_v1.0.0.md) | v1.0.0 リリースノート（Phase 1〜10 要約）|
| [V1_ACCEPTANCE_CHECKLIST.md](release-check/V1_ACCEPTANCE_CHECKLIST.md) | v1.0.0 完成検収チェックリスト（12項目）|
| [V1_SAFETY_LOCK.md](release-check/V1_SAFETY_LOCK.md) | v1.0.0 安全凍結宣言（禁止操作一覧）|
| [V1_ARCHITECTURE_FREEZE.md](release-check/V1_ARCHITECTURE_FREEZE.md) | v1.0.0 アーキテクチャ凍結宣言 |
| [CHANGELOG_PHASE.md](release-check/CHANGELOG_PHASE.md) | Phase 1〜10 変更履歴 |
| [SAFETY_REPORT.md](release-check/SAFETY_REPORT.md) | 外部API安全確認書 |

---

## 画面一覧（v1.0.0）

| 画面 | URL内での表示 |
|------|------------|
| ホーム | 初期表示 |
| AIコックピット | 下部ナビ「コックピット」 |
| 今日の要対応 | 下部ナビ「要対応」 |
| AI相談 | 下部ナビ「AI相談」 |
| 経営ダッシュボード | 下部ナビ「経営」 |
| 設定 | 下部ナビ「設定」 |

---

## 公開URL有効化の手順

GitHub Pages が有効化されていない場合、以下の手順で有効化してください。

1. GitHubにログイン
2. `sakamoto55-boop/shacho-ai-control-tower` リポジトリを開く
3. 上部タブ「Settings」をクリック
4. 左サイドバー「Pages」をクリック
5. 「Source」の「Branch」を `gh-pages` に変更
6. パスは `/（root）`のまま
7. 「Save」ボタンをクリック
8. 数分後に `https://sakamoto55-boop.github.io/shacho-ai-control-tower/` でアクセス可能になります

---

## 自動デプロイ設定（GitHub Actions）

将来の変更を自動でデプロイするための GitHub Actions ワークフローが  
`.github/workflows/deploy-pages.yml` に設定されています。

`main` ブランチに変更がプッシュされると自動ビルド・デプロイが実行されます。

---

## 技術スタック

| 項目 | 内容 |
|------|------|
| フレームワーク | React 18 + TypeScript + Vite 5 |
| デプロイ形式 | 静的サイト（SPA）|
| ホスティング | GitHub Pages |
| アプリサイズ | JS: 386KB（gzip: 117KB）/ CSS: 4.4KB |
| 対応デバイス | iPhone（Safari）優先 / Android Chrome |
| 外部API | なし（全デモモック）|
