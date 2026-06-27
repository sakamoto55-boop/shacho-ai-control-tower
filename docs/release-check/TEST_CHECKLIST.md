# TEST_CHECKLIST.md — 手動検収チェックリスト

> 最終更新: Phase 10 — v1.0.0（2026-06-27）  
> 各項目を実際にブラウザで確認してチェックしてください。

---

## Phase 10 検収チェック（v1.0.0）

### TypeScript ビルド確認
- [ ] `cd client && npm run build` がゼロエラーで完了する
- [ ] `noUnusedLocals` / `noUnusedParameters` エラーが出ない
- [ ] `npx tsc --noEmit` がゼロエラーで完了する

### AIコックピット — AI優先アクション（新規）
- [ ] 「🎯 今日の優先判断」セクションが表示される
- [ ] TOP5カードが rank 1〜5 で表示される
- [ ] 各カードに urgency（critical/high）の色分けがある
- [ ] 「⚡ 今すぐ対応」緊急アクションセクションが表示される
- [ ] 「✅ 社長承認キュー」amber セクションが表示される
- [ ] ActionDraft カードに「この操作は現在UIのみ」テキストがある

### 今日の要対応 — AI優先順タブ（新規）
- [ ] 「🤖 AI優先順」タブ（emerald 背景）が表示される
- [ ] タブ切り替えで DecisionItem カードが表示される
- [ ] 各カードに rank・urgency・reason・suggestedAction が表示される
- [ ] 他のタブ（Gmailタブ・LINE WORKSタブ）が引き続き機能する

### AI相談 — 統合ショートカット（新規）
- [ ] indigo 背景バー（#EEF2FF）が画面上部に表示される
- [ ] 8件のショートカットボタンが表示される
- [ ] 「今日の優先順位TOP5は？」をタップするとAI回答が返る
- [ ] 「会社の健康スコアを教えて」をタップすると健康スコアが返る
- [ ] 各回答に orchestratorResult のデータが反映されている

### 経営ダッシュボード — 会社健康度カード（新規）
- [ ] 「🏢 会社健康度」カードが月次サマリーの前に表示される
- [ ] グレード（A/B/C/D）が大きく表示される（A=green-700, B=blue-700, C=amber-700, D=red-700）
- [ ] 9カテゴリグリッドが表示される（資金繰り / 粗利率 / 未請求 / 未回収 / 事故 / 人員 / 売上 / 社内SOS / 予定負荷）
- [ ] 各カテゴリにグレード文字（A/B/C/D）が表示される
- [ ] リスク警告バー（amber）が表示される（リスクがある場合）

### 設定画面 — v1.0.0 表示
- [ ] バージョンバッジが「v1.0.0 Phase 10」と表示される
- [ ] フェーズ一覧に「Phase 10: AI Engine統合 · 全Provider横断 · 社長承認フロー 実装済」がある
- [ ] 全Provider（5件）が demo 状態で表示される

### 外部書き込みなし（コード確認）
- [ ] `aiOrchestrator.ts` に HTTP fetch/axios 呼び出しが存在しない
- [ ] `actionDraftEngine.ts` の全 ActionDraft に `externalSendDisabled: true` がある
- [ ] `actionDraftEngine.ts` の全 ActionDraft に `saveDisabled: true` がある
- [ ] `aiOrchestrator.ts` の `todayPlan` に `readOnly: true as const` がある

---

## Phase 9 検収チェック

### TypeScript ビルド確認
- [ ] `cd client && npm run build` がゼロエラーで完了する
- [ ] `noUnusedLocals` / `noUnusedParameters` エラーが出ない

### AIコックピット — LINE WORKS通知セクション（新規）
- [ ] 「💬 LINE WORKS通知」セクション（ティール #F0FDFA）が表示される
- [ ] 緊急N件・重要AN件・事故N件・SOSN件のチップが表示される
- [ ] 事故報告・SOS 2件のカードが赤背景で表示される
- [ ] フッターに「デモLINE WORKS · 読み取り専用 · 送信・返信・既読化なし」が表示される

### ホーム画面 — LINE WORKSカード（新規）
- [ ] 「💬 LINE WORKS通知」カード（ティール #F0FDFA）が表示される
- [ ] 緊急件数・重要A件数のチップが表示される
- [ ] 「LINE WORKSの通知を確認する →」ボタンで actions タブへ遷移する

### 今日の要対応 — LINE WORKSセクション（新規）
- [ ] 「💬 LINE WORKS（デモ）」セクションが表示される
- [ ] 通知カードに「返信」「既読」ボタンが存在しない
- [ ] critical通知（事故報告・SOS）が赤ボーダーで表示される
- [ ] high通知（欠勤・車両・遅延）がオレンジボーダーで表示される
- [ ] カードをタップするとモーダルが開く
- [ ] モーダルに「送信・返信・既読化は禁止です」バナーが表示される
- [ ] 受信箱カード4件が表示される（見積・請求・シフト・銀行）

### AI相談 — LINE WORKSショートカットバー（新規）
- [ ] 「💬 LINE WORKSショートカット」バーがティール背景で表示される
- [ ] 6件のショートカットボタンが表示される
- [ ] 「LINE WORKSの通知を要約して」をタップすると通知サマリーが返る
- [ ] 「今日のSOS・緊急連絡は？」をタップするとSOS・緊急情報が返る
- [ ] 各回答に「デモLINE WORKS · 読み取り専用 · 送信・返信・既読化なし」が含まれる

### Settings — Phase 9 更新
- [ ] 「Phase 9 — LINE WORKS Notification 接続 · 書き込みなし」のサブタイトルが表示される
- [ ] LINE WORKS通知が「実装済」になっている
- [ ] Provider健全性にLINE WORKS通知「デモ接続」（ティール）が表示される
- [ ] バージョン「v0.9.0 Phase 9」が設定画面最下部に表示される

### LINE WORKSサービス層 確認（TypeScript型チェック）
- [ ] `mockLineWorksNotifications.length` が 5 を返す
- [ ] `mockLineWorksInboxMessages.length` が 4 を返す
- [ ] `createNotificationSummary()` が criticalCount / accidentCount / sosCount を返す
- [ ] `detectNotificationRisks()` が severity / riskType を含む配列を返す
- [ ] `lineworksFetcher.sendMessage()` が WRITE_FORBIDDEN エラーを throw する

---

## Phase 8 検収チェック

### TypeScript ビルド確認
- [ ] `cd client && npm run build` がゼロエラーで完了する
- [ ] `noUnusedLocals` / `noUnusedParameters` エラーが出ない

### ホーム画面 — BusinessData カード（新規）
- [ ] 「経営数字：8指標」カード（パープル #F5F3FF）が表示される
- [ ] 要対応件数（危険🔴）と上位2件のリスク説明が表示される
- [ ] 粗利率 / 現金残高 / 未請求 / 未回収 チップが表示される
- [ ] 「経営数字を詳しく見る →」ボタンで Dashboard へ遷移する

### AIコックピット — 経営数字サマリーセクション（新規）
- [ ] 「経営数字サマリー（Phase 8）」セクション（パープル #F5F3FF）が表示される
- [ ] 危険 / 警告 カウントチップが表示される
- [ ] 現金残高 / 未請求 / 未回収 / 今月粗利率 の 2×2 グリッドが表示される
- [ ] 上位3件のリスクが重大度付きで表示される
- [ ] フッターに「データ元：デモSheets · 読み取り専用 · セル更新・行追加・削除なし」が表示される

### AI相談画面 — Sheetsショートカット（新規）
- [ ] 「📊 経営数字ショートカット」バーがDriveショートカットの下に表示される（パープル背景）
- [ ] 「経営数字をまとめて」をタップすると現金残高・粗利率・未請求・未回収の回答が返る
- [ ] 「現金残高はいくら？」をタップすると現金残高とステータスが返る
- [ ] 「未請求・未回収を教えて」をタップすると金額が返る
- [ ] 「粗利率は何%？」をタップすると粗利率とステータスが返る
- [ ] 「資金繰りリスクはある？」をタップするとリスク一覧が返る
- [ ] 各回答に「デモSheets · 読み取り専用 · セル更新なし」が含まれる

### Settings — Phase 8 更新
- [ ] 「Phase 8 — Sheets ReadOnly 接続 · 書き込みなし」のサブタイトルが表示される
- [ ] Google Sheets Provider が表示される
- [ ] スコープ表示に sheets.readonly が追加されている（CALENDAR / DRIVE / SHEETS の3スコープがループ表示）
- [ ] 接続ボタンに「Gmail / Calendar / Drive / Sheets ReadOnly」と表示される
- [ ] バージョン「v0.8.0 Phase 8」が設定画面最下部に表示される
- [ ] ロードマップで Phase 4（Sheets）が「実装済」になっている

### Dashboard — Phase 8 フッター更新
- [ ] 注記に「Phase 8 — BusinessData Provider（デモSheets）由来のデータです。セル更新・行追加・削除は行っていません。」が表示される

### Sheets サービス層 確認（TypeScript型チェック）
- [ ] `mockBusinessDataset.metrics.length` が 8 を返す
- [ ] `createBusinessSummary()` が grossProfitRate / cashBalance / unbilledAmount を返す
- [ ] `detectBusinessRisks()` が riskType / severity / description を含む配列を返す
- [ ] `UnifiedBusinessMetric.readOnly` が true を返す
- [ ] `UnifiedBusinessMetric.writeEnabled` が false を返す
- [ ] `sheetsClient.isUsingMock()` が認証なし時に true を返す

### 書き込みなし確認（安全性検証）
- [ ] Google Sheets にセルが更新されていない
- [ ] 行が追加・削除されていない
- [ ] シートが作成・削除されていない
- [ ] 権限・共有設定が変更されていない

---

## Phase 7 検収チェック

### TypeScript ビルド確認
- [ ] `cd client && npm run build` がゼロエラーで完了する
- [ ] `noUnusedLocals` / `noUnusedParameters` エラーが出ない

### ホーム画面 — Driveファイルカード（新規）
- [ ] 「Google Drive ファイル」カード（アンバー #FFFBEB）が表示される
- [ ] 総ファイル数「7件」が表示される
- [ ] 最終更新日が表示される
- [ ] 重要A / 銀行 / 請求 / 監査 カテゴリチップが表示される
- [ ] 最新ファイル名が表示される
- [ ] 「全ファイルを見る →」ボタンでコックピットへ遷移する

### AIコックピット — 最近の重要ファイルセクション（新規）
- [ ] 「最近の重要ファイル」セクション（アンバー #FFFBEB）が表示される
- [ ] 重要A / リスク / 銀行 / 契約 / 請求 カウントチップが表示される
- [ ] ファイルリストに銀行・契約・監査・事故ファイルが表示される
- [ ] 各ファイルに fileType バッジ・重要度バッジ・カテゴリバッジが表示される
- [ ] riskFlag ありのファイルに「リスク」バッジが表示される
- [ ] 推奨アクションが表示される
- [ ] フッターに「ファイル作成・変更・削除なし」が表示される

### AI相談画面 — Driveショートカット（新規）
- [ ] 「📁 Driveショートカット」バーがカレンダーショートカットの下に表示される（アンバー背景）
- [ ] 「銀行資料を探して」をタップすると銀行ファイルの回答が返る
- [ ] 「契約書を探して」をタップすると契約ファイルの回答が返る
- [ ] 「未請求一覧はどこ？」をタップすると請求ファイルの回答が返る
- [ ] 「監査資料を探して」をタップすると監査ファイルの回答が返る
- [ ] 「事故報告書を探して」をタップすると事故ファイルの回答が返る
- [ ] 各回答に「デモDrive · 読み取り専用 · ファイル変更なし」が含まれる

### Settings — Phase 7 更新
- [ ] 「Phase 7 — Drive ReadOnly 接続 · 書き込みなし」のサブタイトルが表示される
- [ ] Google Drive Provider が「未接続」で表示される（接続前）
- [ ] スコープ表示に drive.readonly が追加されている
- [ ] 接続ボタンに「Gmail / Calendar / Drive ReadOnly」と表示される
- [ ] バージョン「v0.7.0 Phase 7」が設定画面最下部に表示される
- [ ] ロードマップで Phase 2（カレンダー）Phase 3（Drive）が「実装済」になっている

### Drive サービス層 確認（TypeScript型チェック）
- [ ] `driveAnalyzer.analyzeCategory()` が 10種カテゴリを返す
- [ ] `driveAnalyzer.analyzeImportance()` が starred ファイルで A を返す
- [ ] `driveAnalyzer.hasRiskFlag()` が銀行・事故カテゴリで true を返す
- [ ] `driveMapper.mapGoogleDriveFileToUnifiedFileItem()` が readOnly:true / writeEnabled:false を返す
- [ ] `driveClient.isUsingMock()` が認証なし時に true を返す
- [ ] `searchDriveFiles('銀行', files)` が関連ファイルを返す

### 書き込みなし確認（安全性検証）
- [ ] Google Drive にファイルが作成されていない
- [ ] 既存のファイルが変更・削除・移動されていない
- [ ] ファイルの権限・共有設定が変更されていない

---

## Phase 6 検収チェック

### TypeScript ビルド確認
- [ ] `cd client && npm run build` がゼロエラーで完了する（69モジュール）
- [ ] `noUnusedLocals` / `noUnusedParameters` エラーが出ない

### ホーム画面 — 今日の予定カード（新規）
- [ ] 「今日の予定」カード（緑背景）が Gmail 要対応サマリーより上に表示される
- [ ] 件数「5件」が表示される
- [ ] 重要/移動/期限カウントチップが表示される
- [ ] 「次の予定：10:00 東京信用金庫 追加資料提出打合せ」が表示される
- [ ] 「デモCalendar」バッジが表示される
- [ ] 「読み取り専用」バッジが表示される
- [ ] 「全予定を見る →」ボタンでコックピットへ遷移する

### AIコックピット — 今日の予定セクション（新規）
- [ ] 「今日の予定：5件」セクションが表示される（緑背景）
- [ ] 重要A/移動注意/期限あり/銀行 のカウントチップが表示される
- [ ] 予定リストに「10:00 銀行打合せ」「13:30 現場確認」「16:00 運営確認」等が表示される
- [ ] 各予定に重要度バッジ・カテゴリバッジが表示される
- [ ] 期限リスクのある予定に「期限」バッジが表示される
- [ ] 場所がある予定に「📍 〇〇」が表示される
- [ ] 推奨アクションが「💡 〇〇」で表示される
- [ ] 「デモCalendar」バッジが表示される（認証未設定時）
- [ ] 「読み取り専用」「予定変更なし」バッジが表示される
- [ ] フッターに「デモCalendar · 予定作成・変更なし · 社長確認のみ」が表示される

### AI相談画面 — カレンダーショートカット（新規）
- [ ] 「📅 カレンダーショートカット」バーが Gmailショートカットの下に表示される（緑背景）
- [ ] 「今日の予定をまとめて」をタップすると予定一覧の回答が返る
- [ ] 「銀行関係の予定だけ見せて」をタップすると銀行予定の回答が返る
- [ ] 「今日の移動が必要な予定は？」をタップすると場所ありの予定が返る
- [ ] 「期限がある予定はどれ？」をタップすると締切・提出予定が返る
- [ ] 「予定とGmailを合わせて優先順位を出して」をタップすると横断優先順位が返る
- [ ] 各回答に「デモCalendar · 読み取り専用 · 予定変更なし」が含まれる

### Settings — AI社長室データ基盤カード（更新）
- [ ] 「Phase 6 — Calendar ReadOnly 接続 · 書き込みなし」のサブタイトルが表示される
- [ ] Googleカレンダー Provider が「未接続」または「接続済み」で表示される（plannedではない）
- [ ] バージョン「v0.6.0 Phase 6」が設定画面最下部に表示される

### Calendar サービス層 確認（TypeScript型チェック）
- [ ] `calendarAnalyzer.analyzeCategory()` が 10種カテゴリを返す
- [ ] `calendarAnalyzer.hasDeadlineRisk()` が区役所・外注費イベントで true を返す
- [ ] `calendarMapper.mapGoogleCalendarEventToUnifiedScheduleItem()` が readOnly:true / writeEnabled:false を返す
- [ ] `calendarClient.isUsingMock()` が認証なし時に true を返す

### Priority Engine 横断スコアリング確認
- [ ] `priorityEngine.scoreInboxItem(bankInboxItem, calendarWithBankEvent)` のスコアが単独より高い
- [ ] `priorityEngine.scoreScheduleItem()` が正常に動作する

### 書き込みなし確認（安全性検証）
- [ ] Google Calendar に新しい予定が作成されていない
- [ ] 既存の予定が変更・削除されていない
- [ ] Google Calendar の招待返信が変更されていない

---

## ビルド確認

- [ ] `cd client && npm run build` がエラーなく完了する
- [ ] `npm run dev` でローカルサーバーが起動する（http://localhost:5173/）
- [ ] コンソールに TypeScript エラーが出ていない

---

## Phase 5.5 検収チェック

### TypeScript ビルド確認
- [ ] `cd client && npm run build` がゼロエラーで完了する
- [ ] `noUnusedLocals` / `noUnusedParameters` エラーが出ない
- [ ] 63モジュール変換完了を確認する

### Settings 画面 — AI社長室データ基盤カード（新規）
- [ ] 「AI社長室データ基盤」カードが表示される（絵文字🏗️）
- [ ] 全体健全性バッジが表示される（△ 一部未接続 など）
- [ ] 接続済み / 計画中 / 合計 の件数チップが表示される
- [ ] 6つのProvider一覧が表示される（Gmail受信トレイ / Googleカレンダー / Google Drive / 経営データ / 社長承認フロー / 朝ブリーフィング）
- [ ] Gmail受信トレイが「未接続」または「接続済み」バッジで表示される
- [ ] 残り5Providerが「計画中」バッジで表示される
- [ ] 各行に「読取専用」バッジが表示される
- [ ] 次フェーズ名が各行に表示される

### AIコックピット画面 — コメント確認（コード確認のみ）
- [ ] `CockpitScreen.tsx` の `const gmailDerivedTasks` 行にコメントがある
- [ ] ファイル冒頭に `providerRegistry / priorityEngine` のコメントアウトimportがある

### core/providers/ ファイル確認（TypeScript型チェック）
- [ ] `providerTypes.ts`: `ProviderConnectionStatus` / `ProviderHealthStatus` が定義されている（`ConnectionStatus` / `HealthStatus` と名前衝突がない）
- [ ] `inboxProvider.ts`: `getDescriptor()` / `getItems()` / `refresh()` が実装されている
- [ ] `providerRegistry.ts`: `getAllDescriptors()` が6件を返す
- [ ] `providerHealth.ts`: `getSummary()` が正しいカウントを返す

### core/ai-engine/ ファイル確認（TypeScript型チェック）
- [ ] `approvalEngine.ts`: `GATE_MESSAGE` が export されている
- [ ] `actionEngine.ts`: すべての提案が `requiresApproval: true` `writeEnabled: false`
- [ ] `riskEngine.ts`: `aggregateRisks()` が重複排除して返す

---

## ビルド確認

- [ ] `cd client && npm run build` がエラーなく完了する
- [ ] `npm run dev` でローカルサーバーが起動する（http://localhost:5173/）
- [ ] コンソールに TypeScript エラーが出ていない

---

## Phase 5.1 検収チェック

### 設定画面 — 接続前チェックパネル（新規）

- [ ] `.env` 未設定状態で「🔍 接続前チェック」パネルが表示される
- [ ] Client ID設定: ❌ 未設定（赤）が表示される
- [ ] Redirect URI設定: ✅ http://localhost:5173/（緑）が表示される
- [ ] スコープ: ✅ gmail.readonly のみ（緑）が常時表示される
- [ ] 書き込みAPI: ✅ 未実装（緑）が常時表示される
- [ ] 本番接続準備: ❌ 未完了（赤）が表示される（Client ID 未設定時）
- [ ] 接続済み状態ではチェックパネルが非表示になる

### バージョン確認

- [ ] 設定画面最下部に「AI社長室 v0.5.1 Phase 5.1」が表示される

---

## Phase 5 検収チェック

### 設定画面 — Google接続カード

- [ ] 「Google アカウント連携（Phase 5）」セクションが表示される
- [ ] カードに「□ 未接続」バッジが表示される（グレー）
- [ ] 「Gmail 読み取り専用」が「○」（未取得、グレー）で表示される
- [ ] 「calendar.readonly（Phase 6以降）」等が淡色で表示される
- [ ] 「⚠️ 書き込み禁止」バナーが黄色で表示される
- [ ] 「🔐 Googleアカウントで接続（Gmail ReadOnly）」ボタンが表示される
- [ ] 接続ボタンをタップすると `VITE_GOOGLE_CLIENT_ID` 未設定エラーが表示される（設定なしの場合）

### 設定画面 — OAuth接続後（ClientID設定後）

- [ ] 接続ボタンタップで Google ログイン画面が開く
- [ ] ログイン・権限承認後にアプリに戻る
- [ ] 「✓ 接続済み」バッジが緑色で表示される
- [ ] 接続したGmailアドレスが表示される
- [ ] 「✓ Gmail 読み取り専用」が緑色で表示される
- [ ] 「🔄 状態を更新」「🔌 切断する」ボタンが表示される
- [ ] 「▼ 認証ログを見る」が表示される
- [ ] ログを開くと `oauth_success` のエントリが確認できる

### 設定画面 — 切断確認

- [ ] 「🔌 切断する」をタップすると「□ 未接続」に戻る
- [ ] 切断後、認証ログに `disconnect` エントリが追加される

### バージョン確認

- [ ] 設定画面最下部に「AI社長室 v0.5.0 Phase 5」が表示される

---

## Phase 4.1 継続確認チェック（リグレッション）

### ホーム画面
- [ ] DemoBanner が表示される
- [ ] Gmail要対応サマリーカード（5件・6種チップ）が表示される
- [ ] AIブリーフィングカード展開/折りたたみが動作する
- [ ] 「🎯 AIコックピットへ」ボタンでコックピットに遷移する
- [ ] 「🤖 AIに相談」ボタンでAI相談に遷移する
- [ ] 「⚡ 要対応へ」ボタンで今日の要対応に遷移する

### AIコックピット画面
- [ ] 会社健康スコアが表示される
- [ ] 優先順位TOP5が表示される
- [ ] Gmailセクションに件数内訳チップが表示される
- [ ] TOP3メールに優先度バッジ・タイプバッジが表示される

### 今日の要対応画面
- [ ] Gmailタスクに「デモGmail」「返信未送信」バッジが表示される
- [ ] Gmailタスクをタップするとモーダルが開く
- [ ] モーダルに「元データ」「受信日時」「書き込み：なし」が表示される
- [ ] モーダルの安全通知「これは下書き案です。Gmailには保存・送信されていません。」が表示される

### AI相談画面
- [ ] Gmailショートカット横スクロールが表示される
- [ ] 「Gmailの要対応をまとめて」をタップするとGmail詳細応答が返る

### 設定画面（既存機能）
- [ ] デモモード ON/OFF トグルが動作する
- [ ] 本番準備モード ON/OFF トグルが動作する
- [ ] 「Gmail読み取りテスト」ボタンで5件取得結果が表示される
- [ ] 会社選択で別会社に切り替えられる

---

## ナビゲーション確認

- [ ] ホーム → コックピット → AI相談 → 要対応 → 経営 の5タブが表示される
- [ ] 各タブ遷移が正常に動作する
- [ ] ⚙️ボタンで設定画面に遷移する
- [ ] 🎤ボタンで音声入力モーダルが開く

---

## 書き込みなし確認（安全性検証）

- [ ] Gmail に新しいメールが届いていない
- [ ] Gmail の未読状態が変わっていない
- [ ] Gmail のラベルが変わっていない
- [ ] Gmail のスター状態が変わっていない
- [ ] Google カレンダーに変更がない
- [ ] Google Drive に変更がない

> **確認方法**: Gmail・Googleカレンダー・Driveを直接開いて変更がないことを目視確認

---

## モバイル表示確認

- [ ] iPhone Safari で正常に表示される（または Chrome DevTools iPhone モード）
- [ ] Safe Area（ノッチ部分）でコンテンツが隠れない
- [ ] 下部ナビゲーションが Safe Area に対応している
- [ ] 縦向き表示で横スクロールが発生しない
