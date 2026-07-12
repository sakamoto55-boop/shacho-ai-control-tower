# V1_ACCEPTANCE_CHECKLIST.md — v1.0.0 完成検収チェックリスト

> Phase 10 完了時点の手動検収チェックリスト  
> スクリーンショット不要。ブラウザ確認 or コード確認で完結。

---

## 検収チェックリスト（12項目）

### 1. ホーム画面 — 表示確認
- [ ] `greeting`（「おはようございます」等）が画面上部に表示される
- [ ] `headline`（朝ブリーフィング見出し）が表示される
- [ ] `todayFocusItems`（今日の注目事項）が表示される
- [ ] LINE WORKS 通知カード（ティール）が表示される
- [ ] Gmail サマリーカード（青）が表示される

### 2. AIコックピット — 全セクション確認
- [ ] 「🏢 会社健康スコア」グレード（A/B/C/D）と数値が表示される
- [ ] 「🎯 今日の優先判断」TOP5 リストが表示される（DecisionItem カード）
- [ ] 「⚡ 今すぐ対応」緊急アクションセクション（red/orange 強調）が表示される
- [ ] 「✅ 社長承認キュー」amber セクションが表示される（ActionDraft 件数）
- [ ] 「💬 LINE WORKS通知」ティールセクションが表示される

### 3. 今日の要対応 — AI優先順タブ確認
- [ ] 「🤖 AI優先順」タブ（emerald 背景）が存在する
- [ ] タブ切り替えで DecisionItem カードが表示される
- [ ] 各カードに「重要度」「緊急度」「推奨アクション」が表示される
- [ ] LINE WORKSタブ・Gmailタブも引き続き表示される

### 4. 会社健康度 — 9カテゴリグリッド確認
- [ ] 経営ダッシュボードに「会社健康度」カードが表示される
- [ ] 資金繰り・粗利率・未請求・未回収・事故・人員・売上・社内SOS・予定負荷 の9カテゴリが表示される
- [ ] グレード（A〜D）が色分け表示される（A=緑、B=青、C=amber、D=赤）
- [ ] 「主要リスク」警告バーが表示される（リスクがある場合）

### 5. 社長承認キュー — 表示確認（amber セクション）
- [ ] AIコックピット内の amber セクションに承認待ちアクションが表示される
- [ ] 各アクションカードに「承認」「修正」「棄却」「委任」の4ボタン（UI表示のみ）がある
- [ ] ボタン押下後「この操作は現在UIのみです」等の表示がある
- [ ] `externalSendDisabled: true` の警告テキストが表示される

### 6. 今日の要対応 — AI優先順タブ（DecisionItem）
- [ ] `rank`（順位）が1〜7で表示される
- [ ] `urgency`（critical/high/medium）が色分け表示される
- [ ] `reason`（優先理由）テキストが表示される
- [ ] `suggestedAction`（推奨アクション）テキストが表示される
- [ ] `timeEstimate`（時間見積）が表示される

### 7. AI相談 — 統合ショートカット表示（indigo バー）
- [ ] indigo 背景（#EEF2FF）のショートカットバーが表示される
- [ ] 「今日の優先順位TOP5は？」等 8件のショートカットボタンが表示される
- [ ] ショートカットをタップするとAI回答が返る
- [ ] 回答に orchestratorResult のデータが反映されている

### 8. 経営ダッシュボード — 健康度カード表示
- [ ] 月次サマリーセクションの前に「会社健康度」カードが表示される
- [ ] 総合スコア（0〜100）が大きく表示される
- [ ] グレードに応じた背景色が適用されている

### 9. 設定画面 — Provider Health / v1.0.0 表示
- [ ] バージョンバッジが「v1.0.0 Phase 10」と表示される
- [ ] サブタイトルが「Phase 10 — AI Engine統合 · 全Provider横断 · 社長承認フロー（UIと型のみ）」と表示される
- [ ] フェーズ一覧に「Phase 10: AI Engine統合 · 全Provider横断 · 社長承認フロー 実装済」がある
- [ ] Provider接続状況（5Provider すべて demo）が表示される

### 10. 外部書き込みなし — コード確認
- [ ] `client/src/services/gmail/gmailFetcher.ts` に `WRITE_FORBIDDEN` パターンがある
- [ ] `client/src/services/lineworks/lineworksFetcher.ts` に `WRITE_FORBIDDEN` パターンがある
- [ ] `client/src/services/calendar/calendarFetcher.ts` に `WRITE_FORBIDDEN` パターンがある
- [ ] `client/src/services/drive/driveFetcher.ts` に `WRITE_FORBIDDEN` パターンがある
- [ ] `client/src/services/sheets/sheetsFetcher.ts` に `WRITE_FORBIDDEN` パターンがある
- [ ] `client/src/core/ai-engine/actionDraftEngine.ts` の全 ActionDraft に `externalSendDisabled: true` がある
- [ ] `client/src/core/ai-engine/actionDraftEngine.ts` の全 ActionDraft に `saveDisabled: true` がある

### 11. ビルド成功確認
- [ ] `cd client && npm run build` がゼロエラーで完了する
- [ ] TypeScript `noUnusedLocals` / `noUnusedParameters` エラーが出ない
- [ ] Vite ビルド出力 `public/` に assets が生成される

### 12. TypeScriptエラーなし
- [ ] `cd client && npx tsc --noEmit` がゼロエラーで完了する
- [ ] `aiOrchestrator.ts` の UnifiedRisk フィールドが型定義と一致している
- [ ] `decisionEngine.ts` に未使用変数がない
- [ ] `actionDraftEngine.ts` の categoryLabelMap が `Record<string, string>` 型である
- [ ] `CockpitScreen.tsx` に重複プロパティがない

---

## 検収完了基準

上記12項目すべてにチェックが入れば、v1.0.0 の検収完了です。

```
[ ] 全12項目チェック完了 → v1.0.0 確定・凍結
```
