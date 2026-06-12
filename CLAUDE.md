# CLAUDE.md

このリポジトリは「社長AI管制塔 Phase 1」です。

## 開発目的

会社メール、LINE WORKS、手入力された外部連絡をAIで分析し、代表取締役が見るべき連絡を絞り込みます。

主な機能：

- 要約
- タスク抽出
- 返信下書き
- A/B/C優先度分類
- リスク判定
- 朝昼晩レポート生成
- ローカル保存
- 将来的なGmail、LINE WORKS、kintone連携

## 重要な制約

- 個人LINEの直接連携は作らない。
- 個人LINE全トーク取得、スクレイピング、RPA操作、通知読み取りは作らない。
- 個人LINE由来の情報は、人間が必要部分だけを転記した `external_forward` として扱う。
- AIによる外部自動返信は作らない。
- 金額、契約、納期、謝罪、責任認定、外注費、労務、事故は自動確定しない。
- APIキーや秘密情報をコードへ直書きしない。
- Phase 1ではUIや管理画面を作らない。

## 優先順位

1. ローカルで動くAPI
2. MockAIProviderによる分析の形
3. LocalRepositoryによる保存
4. 朝昼晩レポート生成
5. テスト
6. README整備
7. 将来Connectorの骨組み

## やるべきでないこと

- 大規模な認証システムを作る
- 本番APIキーを要求する
- kintone前提の実装にする
- Gmail/LINE WORKS本番接続を先に進める
- 個人LINEを直接読む設計にする
- 管理画面を先に作る

## 開発コマンド

```bash
npm install
npm run dev
npm test
npm run build
```

## アーキテクチャ

- `src/ai`：AI分析
- `src/domain`：型、分類ルール、リスクルール
- `src/repositories`：保存層
- `src/connectors`：将来外部接続
- `src/reports`：朝昼晩レポート
- `src/jobs`：ジョブ処理
- `src/server.ts`：APIサーバー

## 判断に迷った場合

Phase 1の目的である「メッセージ分析、タスク抽出、返信下書き、リスク判定、朝昼晩レポート」を優先してください。
