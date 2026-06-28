# UAT A不具合修正 作業サマリー

**ブランチ**: `claude/lcc-data-persistence-fix-cmrrwc`  
**対象ファイル**: `lcc-redesigned.html`  
**作業日**: 2026-06-28

---

## 1. データ依存問題の原因分析

### 根本原因

| 箇所 | 問題 |
|------|------|
| `save()`（旧実装） | `activeProjectId`・`activeEstimateId`をlocalStorageに永続化 |
| `load()` | 起動時に`activeProjectId`・`activeEstimateId`を復元 |
| `mounted()` | `activeProjectId`が設定済みの場合、自動で案件ハブを開く |

これにより、アプリを開くたびに前回最後に操作した案件が自動表示され、  
「新規登録したい」場面で過去データに依存した画面から始まる問題が発生していた。

### 影響範囲

- 帰り道・電話直後に新しい案件を登録しようとした時
- 別の顧客の案件を新規登録しようとした時
- 新規見積を作成しようとした時（前回の見積ツリーが残っている）

---

## 2. 修正方針

**「見積起点」→「案件起点」に変更**

- アプリ起動時は必ず案件一覧から開始
- 新規案件登録は必ず空の状態から開始
- `activeProjectId`・`activeEstimateId`は永続化しない（セッション内のみ保持）

---

## 3. 実施した修正（必須改修1〜7）

### 必須改修1・2：クイック案件登録
- 案件一覧の最上部に「⚡ クイック案件登録」ボタンを追加
- 最小入力フォーム（顧客名・電話番号・現場住所・案件種別・受付日・担当者・メモ・写真・次アクション）
- 登録後に「続けて見積作成」「現調予定を登録」「案件一覧へ戻る」「後で編集」を提示

### 必須改修3：新規登録時に過去データを引き継がない
- `save()` から `activeProjectId`・`activeEstimateId` を除外
- `load()` で `activeProjectId`・`activeEstimateId` を復元しない（常に空文字）
- `mounted()` でオート案件ハブ表示を削除
- `seedDemo()` でも `activeProjectId`・`activeEstimateId` を設定しない

### 必須改修4：既存顧客から新規案件を作成
- 顧客詳細の「＋ 新規案件を作成」ボタンを強調（オレンジ色に変更）
- 「新規案件IDを発行・過去案件には影響しません」の説明文を追加
- `lccNewProjectForCustomer()` に新しい案件IDを発行する旨のトースト追加

### 必須改修5：見積画面入口の整理
- 積算サブタブ最上部に見積バージョン管理バーを追加
  - 見積一覧をタブ形式で表示（v1・v2・v3...）
  - 「＋ 新バージョン」ボタン
- 受注済み・施工中・完了ステータス時は**赤いロックバナー**を表示
  - 「🔒受注済み・見積ロック中」と明示
  - 受注済みと新規見積を混同しないよう分離

### 必須改修6：全画面コンテキストバー
- ヘッダーに常時表示：顧客名・案件名・案件ID・見積ID・ステータス
- 受注済みは「🔒受注済」を赤バッジで表示
- 案件未選択時は「案件未選択」を黄色で表示

### 必須改修7：ID体系の分離
- `newProjectObj()` に `kind`・`receivedAt`・`responsible`・`nextAction` を追加
- 見積オブジェクトに `version`・`copySourceId` を追加
- 既存データとの互換処理（`load()` 内でフィールド補完）
- ID体系：顧客ID → 案件ID（複数可） → 見積ID（複数可・version管理）

---

## 4. 新規案件登録画面の仕様

### クイック案件登録フォーム

| フィールド | 必須 | 備考 |
|-----------|------|------|
| 顧客名 | 任意 | 既存顧客選択も可 |
| 電話番号 | 任意 | - |
| 現場住所 | 任意 | 分かる範囲で可 |
| 案件種別 | 任意 | 解体/外構/草刈り/伐採/残置物/修繕/その他 |
| 受付日 | 任意 | デフォルト：当日 |
| 担当者 | 任意 | デフォルト：設定の担当者名 |
| メモ | 任意 | コメントとして登録 |
| 写真 | 任意 | 現場写真として登録 |
| 次アクション | 任意 | 現調する/見積を作る/後で確認/保留 |

### 登録後アクション

1. **続けて見積を作成** → 積算サブタブへ
2. **現調予定を登録** → ステータスを「現調」に変更して案件ハブへ
3. **案件一覧へ戻る** → 一覧へ戻る
4. **後で編集** → 案件ハブへ

---

## 5. 顧客・案件・見積のID分離

```
顧客ID (c-xxxxxxxx)
  ├── 案件ID-1 (p-yyyyyyyy)
  │     ├── 見積ID-1 (e-zzzzzzzz, v1)
  │     ├── 見積ID-2 (e-wwwwwwww, v2, copySourceId=e-zzzzzzzz)
  │     └── 見積ID-3 (e-vvvvvvvv, v3)
  ├── 案件ID-2 (p-aaaaaaaa)  ← 別工事・別見積
  └── 案件ID-3 (p-bbbbbbbb)  ← さらに別工事
```

---

## 6. 既存データへの影響範囲

| 項目 | 影響 |
|------|------|
| 顧客データ | 影響なし |
| 案件データ | 新フィールド追加（kind/receivedAt/responsible/nextAction）、旧データは空文字で補完 |
| 見積データ | 新フィールド追加（version/copySourceId）、旧データはindex+1でversionを補完 |
| localStorage | activeProjectId/activeEstimateIdの保存・復元なし（旧データに残っていても無視） |
| バックアップJSON | 設定・顧客・案件・見積・テンプレートは変更なし（activeProjectId除外） |

---

## 7. テスト結果チェックリスト

- [x] 新規案件登録時に過去顧客が残らない（mounted()でクリア）
- [x] 新規案件登録時に過去見積が残らない（save()から除外）
- [x] 既存顧客から新規案件を作れる（lccNewProjectForCustomer）
- [x] 既存顧客を選んでも過去見積に自動遷移しない（自動遷移ロジック削除）
- [x] 受注済み見積はロック表示される（isContractLocked computed）
- [x] 顧客ID・案件ID・見積ID・見積版IDが分離（newProjectObj/lccAddEstimate）
- [ ] 保存・読込・バックアップ・復元が正常（要実機確認）
- [ ] Console Errorゼロ（要ブラウザ確認）
- [ ] iPad Safariでクイック案件登録が使える（要実機確認）
- [ ] スマホで30〜60秒以内に案件登録できる（要実機確認）

---

## 8. フェーズ2設計書

`PHASE2_DESIGN_OCR_VOUCHER_BOX.md` を参照してください。

---

## 9. 本線UAT環境への反映可否

| 対象 | 反映可否 | 備考 |
|------|---------|------|
| 必須改修1〜7（lcc-redesigned.html） | **可** | UAT確認後に反映 |
| フェーズ2（証憑BOX・OCR） | 保留 | UAT完了後に計画 |
| Lサポv3 | 別件・保留 | 本線UAT完了後に判断 |

---

## 10. ロールバック手順

```bash
# 1. 現在の変更をGit確認
git log --oneline -5

# 2. 前のコミットに戻す場合
git checkout <前のコミットハッシュ> -- lcc-redesigned.html

# 3. localStorageクリア（ブラウザ操作）
# DevTools > Application > Local Storage > lcc_v1 > Delete

# 4. アプリ再起動で旧バージョンに戻る
```

---

## 補完したメソッド（旧コードのバグ修正）

以下は既存テンプレートから参照されていたが未定義だったメソッドを追加:

| メソッド | 処理 |
|---------|------|
| `addPhotos(e)` | `onPhotoFiles(e)` を呼ぶ（写真追加） |
| `attachCommentPhoto(e)` | `onCommentImg(e)` を呼ぶ（コメント写真） |
| `exportExcel()` | `exportEstExcel()` を呼ぶ（Excel出力） |
| `exportCSV()` | `exportEstCsv()` を呼ぶ（CSV出力） |
| `tagColor(t)` | 写真タグの色を返す |
| `isContractLocked` | 受注済みかどうかのcomputed |
