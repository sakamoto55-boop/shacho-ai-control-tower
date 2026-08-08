# IT担当向け設定手順 — LCC COMMAND

## 前提ソフト
- Node.js 20以上（https://nodejs.org LTS版）
- モダンブラウザ（Chrome / Edge）

## 初期設定（1回だけ・約15分）
1. このフォルダをPCの任意の場所へ展開（例: `C:\lcc-command`）
2. `.env.example` をコピーして `.env` を作成し、以下を設定:
   - `ANTHROPIC_API_KEY=`（Anthropicコンソールで発行）
   - `GOOGLE_SERVICE_ACCOUNT_FILE=./secure/sa.json`（GCPで発行したSA鍵を`secure/`フォルダへ）
   - `LCC_COMMAND_MODE=production`
   - `LCC_SHEETS_SOURCES=`（`config/sheets.sources.example.json` の配列を1行JSONで）
   - `LCC_COMMAND_COMPANIES=[{"companyId":"lcc","name":"株式会社LCC"}]`
   - `LCC_COMMAND_API_TOKENS={"<長いランダム文字列>":{"role":"PRESIDENT","companyIds":["*"],"label":"社長"}}`
     ※本番モードはトークン必須（フェイルクローズ）。トークンは32文字以上のランダム推奨
3. 対象4シートをSAメールへ「閲覧者」共有（People OS=給与は共有しない）
4. `npm install` → `npm run command:beta`（全条件の自動判定と不足の案内が出ます）

## 使用ポート・Firewall
- ポート: **8787**（`PORT`環境変数はなし。変更時は`src/server.ts`）
- PC単体利用: Firewall設定不要（localhost）
- スマホ等から利用: Windows Defender Firewallで**TCP 8787の受信を許可**（プライベートネットワークのみ推奨）

## ログ確認
- 起動ターミナルに標準出力。常用時は `npm run dev > logs\server.log 2>&1` 等でリダイレクト
- 会話メタデータ: `GET /command/observability`（管理ロールのみ・本文は保存されない）

## エラー時
- 401 → トークン未設定/不一致（UIは `?token=<トークン>` を一度付けて開くと保存されます）
- DATA UNAVAILABLE → シート接続不可。`npm run command:sanity` で原因確認
- 生成PDFが文字化け → `.env` に `LCC_PDF_FONT=C:\Windows\Fonts\meiryo.ttc` を設定
