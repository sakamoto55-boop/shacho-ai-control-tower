# CLAUDE.md（solo-ai-sanbo）

一人事業のAI参謀。ルートの `src/`（会社向けの社長AI管制塔）とは**別プロジェクト**で、相互のimportは禁止。
一人運用に要らない概念（部署、担当者振り分け、承認フロー、5事業の分類）を持ち込まないために分けている。

## 開発コマンド

```bash
cd solo-ai-sanbo
npm install
npm run sanbo             # ヘルプ
npm test                  # vitest run
npx vitest run tests/cli/cli.test.ts
npm run build             # tsc（src/ のみ）
```

## 設計の中心

一人の資源は時間だけ。したがってこの道具は**柱ごとの時間あたり粗利（`PillarSummary.profitPerHourYen`）**を主役に置く。
売上ではなく時給で柱を比べられることが、「何で稼ぐか」を決める材料になる。

```
CLI (src/cli/index.ts)
  → コマンド (src/cli/commands/*.ts)
    → Store (src/repositories/Store.ts) … data/sanbo.json 1ファイル
    → 集計 (src/domain/pillarRules.ts, dealRules.ts)
    → 出力 (src/reports/morningBrief.ts, weeklyReview.ts)
    → 下書き (src/ai/createProvider.ts → MockAIProvider | AnthropicProvider)
```

- `src/domain/types.ts` が全型の起点。扱うのは Pillar / Deal / TimeEntry / MoneyEntry の4つだけ。増やす前に、本当に一人で記録し続けられるか考える。
- `MockAIProvider` は APIキーなしで動く既定。ルールだけで下書きを作る。`AnthropicProvider` と原則（決めない・送らない）を必ず揃える。プロンプトは `src/ai/prompts.ts` に集約。
- 時給が出せない柱（時間の記録が0）は `profitPerHourYen: null`。**0円と混同させない**ため。
- 未入金は段階（`invoiced`）だけで判定せず、その案件に紐づく入金記録を差し引く（`unpaidYen`）。段階を進め忘れた案件が永遠に未入金として出るのを防ぐ。

## 参謀の原則（変更禁止）

- AIに方針を決めさせない。レポートは「事実 + 選択肢」で書き、「〜すべき」と書かない。`BriefItem.options` を必ず埋める。
- AIに**金額・納期・工期・保証範囲・契約条件・謝罪・責任の所在**を決めさせない。文中は `【金額】` のように空欄にし、`DraftResult.leftToYou` に理由を残す。
- AIから外部へ送信しない。返信・投稿・見積はすべて下書きまで。出力の最後に送っていないことを明示する。
- 誇大広告表現（必ず、絶対、最安、日本一、100%）を生成しない。

## CLIの作法

- 毎日打つものなので、依存を増やさない。引数は `src/cli/args.ts` の自前パーサで十分。
- 柱・案件はIDの先頭一致と名前の部分一致の両方で指せる（`src/cli/resolve.ts`）。UUIDを打たせない。
- エラーは `CliError` で投げ、**次に打つコマンドまで書く**（例：「`sanbo pillar list` で確認してください」）。
- 記録が漏れると数字が狂う場面では、その場で次の一手を促す（入金済みに進めたのに金額未記録、見直し日なしの柱など）。

## やるべきでないこと

- 会社向け（ルートの `src/`）のコードをimportする
- データベースを導入する（JSON 1ファイルを開いて直せることが価値）
- 管理画面やWeb UIを先に作る
- 記録項目を増やす（続かない記録は数字を壊す）
- AIに判断させる方向へ寄せる
