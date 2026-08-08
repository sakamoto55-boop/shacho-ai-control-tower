# OPERATIONS — LCC COMMAND 運用手順書

対象: 運用担当者（IT担当・社長）。開発知識は不要です。

## 起動

前提（初回のみ）: Node.js 20以上 / `npm install` / `.env` 設定（`.env.example`参照。最小: `ANTHROPIC_API_KEY`・`GOOGLE_SERVICE_ACCOUNT_FILE`・`LCC_COMMAND_MODE=production`・`LCC_SHEETS_SOURCES`・`LCC_COMMAND_COMPANIES`・`LCC_COMMAND_API_TOKENS`）

- **ワンクリック起動**: `start-lcc-command.bat`（Windows）をダブルクリック
- 手動起動: `npm run dev`（既定 http://localhost:8787）
- 画面: ブラウザで `docs/lcc-command-vui.html` を開く（API接続先は `?api=http://localhost:8787` で指定可）
- 動作確認: `curl http://localhost:8787/health` / `npm run command:beta`

## 停止

起動したターミナル（黒い画面）で `Ctrl + C`。またはウィンドウを閉じる。

## バックアップ（毎日推奨）

以下の3つをコピーするだけで全記憶・全設定が残ります:

| 対象 | 内容 |
|---|---|
| `data/` フォルダ | 記憶・判断・承認・実験・Growth履歴・生成物（システムの頭脳） |
| `.env` ファイル | 接続設定・APIキー |
| `secure/` フォルダ | Google Service Account鍵 |

例（Windows・タスクスケジューラ登録可）: `xcopy data D:\backup\lcc-command\data /E /Y`

## 復旧

1. 新しいPCで `git clone` → `npm install`
2. バックアップした `data/` `.env` `secure/` を同じ場所に戻す
3. `npm run command:beta` で全条件確認 → `npm run dev`

記憶・会社憲法・目標・Incident・Growth履歴はすべて `data/` にあるため、これで完全復旧します。

## 日次運用（自動化推奨）

| コマンド | 内容 | 頻度 |
|---|---|---|
| `npm run command:growth` | Growth日次観測（READ ONLY） | 毎朝 |
| `npm run command:sanity` | 実データ件数照合 | 毎朝 |
| `npm run command:maintenance` | Memory夜間整理（既定DRY RUN） | 毎晩 |
| `npm run command:beta` | 全体健全性チェック | 週1 |

## 障害時

- 画面に「CONNECTION ERROR」→ サーバーが停止しています。再起動してください（デモ数値は表示されません=正常な安全動作）
- 「DATA UNAVAILABLE」→ Googleシートに接続できていません。`npm run command:sanity` で原因確認
- 誤回答・遅延など → `POST /command/incidents` またはIncident記録画面で記録（削除されず、同種3件で自動的に改善候補化されます）

## 秘密情報の扱い

- APIキー・SA鍵は `.env` / `secure/` のみ（Git管理外・ログ非出力を確認済み）
- キーの作り替え: Anthropicコンソール / GCPコンソールで再発行 → `.env` を書き換え → 再起動
