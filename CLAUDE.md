# LCC統合業務アプリ 改修ルール

## 最重要
current-8090/lcc.html を正本とする。
fix-candidate/lcc-redesigned.html は参考実装であり、丸ごと上書き禁止。
output/lcc.html が成果物（current-8090 ベースに差分のみ移植）。

## 今回の目的
新規案件登録導線を改善し、前回顧客・前回案件・前回見積への自動依存を排除する。

## 絶対に守ること
- 既存P0修正を後退させない
- 受注済み見積の金額・原価・粗利率・税額を変更しない
- load() で既存見積の price/cost/marginPct/qty をマスタ値で上書きしない
- 新規案件登録は空の状態から始める（activeProjectId / activeEstimateId を起動時に復元しない）
- 顧客ID・案件ID・見積ID・見積版IDを分離する
- APIキーを追加しない
- AI_PROVIDER は mock のまま
- OCR / Cloud Vision / Document AI は設計のみ。本体実装しない
- Lサポv3 は本線UAT完了後まで統合しない

## 合格条件
- 元データを読み込んでも金額が変わらない
- 新規案件登録で過去データを引き継がない
- 受注済み見積は編集不可
- Console Errorゼロ
- CSV/TSVインジェクション対策維持（= + - @ 始まり無害化）
- GAS URL は https のみ通る
- バックアップ復元で危険設定値が上書きされない

## P0修正リスト（絶対に後退させないこと）
- Console Errorゼロ
- CSV/TSVインジェクション対策
- XSS対策
- GAS URL https強制
- 外部JSON importのセーフマージ
- localStorage警告
- 画像圧縮
- 日付NaN対策
- ゼロ割対策
- 粗利率可変化
- zeroMarginKeywords
- 受注時ロック
- 受注済み見積の編集禁止
