# OPERATION_ROADMAP.md — AI社長室 運用ロードマップ

> 本番運用に向けた段階計画（確定版）  
> 2026-06-27

---

## 全体方針：3段階で育てる

```
短期（今すぐ）   ：ChatGPT連携で実運用を開始（アプリは触らず手元で回す）
中期（数週〜）   ：Claude Codeで専用アプリに実データを接続（Gmail→Calendar→…）
長期（数ヶ月〜） ：AI社長室をPlatform化（承認後実行・複数社・自動レポート）
```

二本立て: 「ChatGPTで今日から実務を回す」と「Claude Codeでアプリを本番化する」を並行。

---

## 短期：ChatGPT連携で実運用

アプリの本番接続を待たず、**今日から ChatGPT で実務を回す**フェーズ。

- 社長が Gmail / Calendar / Drive の内容を ChatGPT に貼る or 共有 → 要約・優先順位・返信文の下書き
- AI社長室アプリは「デモで全体像を確認する場」として併用
- コスト最小・リスクほぼゼロ（外部書き込みなし・手動運用）

到達目標: 「毎朝の判断を AI で時短する」習慣を先に作る。

---

## 中期：Claude Codeアプリへ実データ接続

専用アプリ（AI社長室）に、読み取り専用で実データを順次つなぐフェーズ。  
Mission 単位で1つずつ安全に接続する。

### Mission 1 — Gmail（✅ 接続構造 実装済み / Phase 11）
- `gmail.readonly` で未読・過去24時間を取得
- 設定画面から OAuth 接続 → AIコックピットに実メール反映
- 残作業: 社長の Client ID 設定・接続テスト

### Mission 2 — Calendar
- `calendar.readonly` を追加
- 今日〜1週間の予定を Schedule Provider に実接続
- Gmail × Calendar 横断（「銀行メール」と「銀行打合せ」を関連付け）

### Mission 3 — Drive
- `drive.readonly` を追加
- 契約・請求・銀行資料のメタデータを File Provider に実接続
- 予定・メールとファイルの三元横断

### Mission 4 — Sheets
- `spreadsheets.readonly` を追加
- 売上・粗利・資金繰り・未回収を BusinessData Provider に実接続
- 会社健康スコアを実データで自動算出

### Mission 5 — LINE WORKS
- **バックエンドProxy 必須**（client_secret をフロントに置けない）
- 通知・社内連絡を Notification Provider に実接続（読み取りのみ）
- 事故・SOS の即時把握

### Mission 6 — 承認後実行（最重要・最後）
- 社長承認後に限り、Gmail下書き作成等を実行（送信は人間最終確認必須）
- 金額・契約・納期・謝罪・責任認定・労務・事故は自動確定しない
- バックエンド + 監査ログ必須

---

## 長期：AI社長室 Platform化

- 朝昼晩レポートの自動生成・自動通知
- 複数社・複数事業（建設 / 福祉「お結び」等）対応
- 承認履歴の永続化・監査証跡
- 権限分離（社長 / 管理者 / 事務 / 現場）
- KPI ダッシュボードの常時更新

---

## Mission 進行順（推奨）

```
Mission 1 Gmail（実装済・設定待ち）
   ↓
Mission 2 Calendar
   ↓
Mission 3 Drive
   ↓
Mission 4 Sheets
   ↓
Mission 5 LINE WORKS（バックエンド構築が前提）
   ↓
Mission 6 承認後実行（バックエンド + 監査ログ必須）
```

各 Mission は「読み取り専用で接続 → 1週間運用検証 → 次へ」を徹底。
