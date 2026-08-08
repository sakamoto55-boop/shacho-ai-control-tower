# LIVE BETA CHECKLIST — 社長に必要な最小操作

LIVE READ-ONLY BETA開始に必要な操作は **3つ** です（所要目安: 合計30〜40分）。
進捗はいつでも `npm run command:beta` で確認できます（未達条件と次の手順を表示します）。

## 操作1: Google Sheets Service Account（15〜20分・IT担当へ依頼可）

1. [Google Cloud Console](https://console.cloud.google.com/) → プロジェクト作成（例: `lcc-command`）
2. 「APIとサービス」→ Google Sheets API を有効化
3. 「IAMと管理 → サービスアカウント」→ 作成（ロール付与は不要）
4. キー → 「鍵を追加」→ JSON をダウンロード
5. JSONファイルをサーバーの安全な場所へ置き、`.env` に設定:
   ```
   GOOGLE_SERVICE_ACCOUNT_FILE=/secure/lcc-command-sa.json
   LCC_COMMAND_MODE=production
   ```
6. **対象シートをService Accountのメールアドレスへ「閲覧者」で共有**（これがREAD ONLYの実体）:
   - 統合業務システムDB / 日報データ（AI読み取り）/ LCCデジタル配置板DB / 経営の聖書 第13期 v7 社長用
   - People OS v17 は共有しない（給与・高機密。Phase LIVE では接続対象外）
7. 確認: `npm run command:sanity`（件数照合がPASSするまで実データは会話に出ません）

## 操作2: 実LLM APIキー（5分）

最小1つ。推奨は Anthropic（最初の実Provider）:

```
ANTHROPIC_API_KEY=sk-ant-...
```

任意で追加: `OPENAI_API_KEY`（+画像生成）/ `GEMINI_API_KEY` / `MANUS_API_KEY`。
キーは `.env` のみ（コード・Git・ログ・画面には出ません）。

## 操作3: 承認（5〜10分）

1. **会社憲法**: チャットで「承認事項を見せて」→ 内容確認 → 「全部この内容で確定」
   → 第13期目標値は「不動産課15.0で確定」（Conflict解消項目のため個別確認）
   - 保留3件（武蔵野式3段管理・X2粗利信号・DX細目）は後日で問題ありません
2. **経営目標**: 「目標を確認したい」→ 候補の承認（憲法確定後にTarget登録へ進めます）

## 開始後に自動で始まるもの（操作不要）

- `npm run command:beta` — Gate全条件の確認（sanity自動実行を含む）
- `npm run command:real-eval` — 実データ100問評価 + 30ターン連続会話試験
- `npm run command:growth` — Growth Baseline（開始日が基準日になります。日次cron推奨）
- Incident記録（`POST /command/incidents`）と週次Growth Review（Company/AI/Data 3分離）

## まだ待ってよいもの（BETAを止めません）

- 銀行明細（DG-004: 取引金融機関5機関は特定済み。明細の取得方法が決まり次第）
- 会計システム（DG-005: ソフト名とエクスポート可否の確認後）
- 日報の案件ID紐付けルール（DG-003: Crosswalk運用の決定後）
