# LCC統合業務アプリ URL・成果物引き継ぎ台帳
作成日: 2026-06-28

## 目的
Claude CodeがManusのステージングURLや各成果物の役割を自動把握できないため、URL、成果物、正本関係、デプロイ判断を明文化する。

## 1. URL台帳

### 8090: 本線UAT環境（正本・Lサポ未統合）
- ポータル: https://8090-ihixk92i15ju66lzxbb1q-7634daff.sg1.manus.computer/index.html
- 見積: https://8090-ihixk92i15ju66lzxbb1q-7634daff.sg1.manus.computer/lcc.html
- 原価: https://8090-ihixk92i15ju66lzxbb1q-7634daff.sg1.manus.computer/lcc-cost.html

用途:
- 現在の本線UAT対象。
- P0修正済みの正本として扱う。
- Lサポはまだ統合しない。
- Claude Codeの修正は、この8090相当コードをベースに差分反映する。

### 8091: Lサポ検証環境（別環境・本線ではない）
- ポータル: https://8091-ivzy0o78qsxo2u45a4a1s-57fd094c.sg1.manus.computer/index.html
- 見積: https://8091-ivzy0o78qsxo2u45a4a1s-57fd094c.sg1.manus.computer/lcc.html
- 原価: https://8091-ivzy0o78qsxo2u45a4a1s-57fd094c.sg1.manus.computer/lcc-cost.html

用途:
- Lサポv3 A案固定の検証環境。
- 本線UATにはまだ統合しない。
- Claude Codeの今回修正にはLサポ関連コードを混ぜない。

### Claude Code成果物: output/lcc.html
- URLは未発行。
- これはファイル成果物であり、サーバーに配置されるまで外部URLは存在しない。
- ローカル確認する場合は、outputディレクトリでローカルサーバーを起動して確認する。

例:
```bash
cd output
python3 -m http.server 8088
```
確認URL:
```text
http://localhost:8088/lcc.html
```

## 2. 3成果物の関係

1. current-8090 / 8090ステージング
   - 正本。
   - 本線UAT対象。
   - P0修正済み。
   - Lサポ未統合。

2. staging8091 / 8091ステージング
   - Lサポ検証用。
   - 本線ではない。
   - Lサポv3は本番候補だが、8090 UAT完了まで統合しない。

3. output/lcc.html
   - Claude Codeによる新規案件登録導線・前回データ依存修正済み候補。
   - URLはまだない。
   - 差分確認後、承認されれば8090のlcc.htmlとして反映する。

## 3. Claude Codeへの固定指示

- 8090を正本とする。
- 8091はLサポ検証環境であり、本線修正のベースにしない。
- output/lcc.htmlは反映候補であり、すぐ本番配置しない。
- lcc-redesigned.htmlは参考実装であり、丸ごと採用しない。
- Lサポ関連コードは今回の8090本線修正に混ぜない。
- 本線UATへ反映するファイル名は lcc.html のまま。
- current-8090/lcc.html は削除せず、ロールバック用に保管する。

## 4. 本線UAT反映前の確認条件

- 旧データの顧客・案件・見積数が変わらない。
- 受注済み見積の price / cost / marginPct / 税額が変わらない。
- 起動時に前回案件・前回見積を自動復元しない。
- 新規案件登録時に過去顧客・過去見積が残らない。
- 既存顧客から新規案件を作れる。
- 受注済み・施工中・完了で見積編集不可。
- CSV/TSVインジェクション対策維持。
- GAS https強制維持。
- 画像圧縮維持。
- zeroMarginKeywords維持。
- defaultMarginPct維持。
- Console Errorゼロ。
- Lサポ関連が混入していない。

## 5. Claude Codeにそのまま伝える短文

以下をClaude Codeへ送る:

```text
あなたはManusのURLを自動では把握していない可能性があるため、URL台帳を渡します。

8090は本線UAT環境です。
- ポータル: https://8090-ihixk92i15ju66lzxbb1q-7634daff.sg1.manus.computer/index.html
- 見積: https://8090-ihixk92i15ju66lzxbb1q-7634daff.sg1.manus.computer/lcc.html
- 原価: https://8090-ihixk92i15ju66lzxbb1q-7634daff.sg1.manus.computer/lcc-cost.html

8091はLサポ検証環境です。本線ではありません。
- ポータル: https://8091-ivzy0o78qsxo2u45a4a1s-57fd094c.sg1.manus.computer/index.html
- 見積: https://8091-ivzy0o78qsxo2u45a4a1s-57fd094c.sg1.manus.computer/lcc.html
- 原価: https://8091-ivzy0o78qsxo2u45a4a1s-57fd094c.sg1.manus.computer/lcc-cost.html

output/lcc.html はあなたが作成した修正済み成果物ファイルであり、まだURLはありません。
確認したい場合は output ディレクトリで `python3 -m http.server 8088` を起動し、`http://localhost:8088/lcc.html` で確認してください。

今回の本線反映候補は output/lcc.html ですが、反映先ファイル名は lcc.html のままです。
current-8090/lcc.html は削除せず、ロールバック用として保管してください。
Lサポ関連コードは8090本線修正に混ぜないでください。
```
