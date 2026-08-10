# CROSSWALK REPORT（TRACK B V1）

## 判定ルール（固定）

| 一致キー | 判定 | 自動統合 |
|---|---|---|
| 同一Source ID | CONFIRMED | 可（同一Source内の重複排除のみ） |
| boardId / boardNo等の正式ID一致 | CONFIRMED候補 | 承認後のみ |
| 電話番号・法人番号等の一意値一致 | HIGH | 承認後のみ |
| 名称＋住所等の複合一致 | MEDIUM | **不可**（承認候補として表示） |
| 名称のみ一致 | LOW | **不可**（承認候補として表示） |

## 現状（2026-08-10 初回同期時点）

- **confirmed**: LCC統合業務システムDB内の customer/project は Source ID（boardId系）で一意。
  Vault取込4,825行はcontentHashで重複0件を確認（同一Source内CONFIRMED）
- **candidates**: 0件（クロスSource照合は日報・LINEWORKS・CASE_DBの接続完了後に生成。
  日報3,539行には案件名・現場名列が存在するが、名称のみ一致はLOWのため自動統合対象にしない）
- **unresolved**: AnyONE（export未着）・TKC（月次CSV未着）・freee（未認可）はCrosswalk未実施

## 誤統合防止

- 同名別顧客: 名称のみ一致はLOW扱いで自動統合しないため、同名別顧客は別レコードのまま保持される
- raw IDは振り直さない（sourceRecordIdは原本ID。無い場合のみ `タブ:rowN` 位置参照で新ID発行しない）
