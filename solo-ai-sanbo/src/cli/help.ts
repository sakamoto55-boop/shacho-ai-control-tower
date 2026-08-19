export const HELP_TEXT = `AI参謀 — 一人事業の記録と材料出し

  決めるのはあなた。参謀は数えることと書くことをやります。

柱（何で稼ぐか）
  sanbo pillar add <名前> --kind service|content|contract|other [--review 30日後] [--target 30万]
  sanbo pillar list
  sanbo pillar set <柱> [--status testing|active|paused|dropped] [--review 60日後] [--target 50万] [--name 新しい名前]

案件
  sanbo deal add <件名> --pillar <柱> [--client 名前] [--amount 30万] [--cost 5万] [--next "やること"] [--due 明日]
  sanbo deal list [--all]
  sanbo deal move <案件> <inquiry|talking|quoted|won|delivering|invoiced|paid|lost>
  sanbo deal touch <案件> [--next "やること"] [--due 3日後]
  sanbo deal set <案件> [--amount 50万] [--cost 10万] [--next "..."] [--due 明日] [--client 名前] [--memo "..."]

時間（1日の終わりに1行でよい）
  sanbo time <分> --pillar <柱> [--deal <案件>] [--cat sales|delivery|content|admin|learning] [--date 今日] [--note "..."]
  sanbo time list [--days 7]

お金
  sanbo money in <金額> --pillar <柱> [--deal <案件>] [--label "..."] [--date 今日]
  sanbo money out <金額> --pillar <柱> [--deal <案件>] [--label "..."] [--date 今日]

読むもの
  sanbo brief              朝の材料（期限・放置・未入金・見直し）
  sanbo review [--days 7]  柱ごとの時間・粗利・時給

下書き（送信も投稿もしません）
  sanbo draft reply <相手の文面> [--context "背景"]
  sanbo draft estimate <案件の概要> [--context "現場の条件"]
  sanbo draft content <テーマ> [--pillar <柱>]

指定のしかた
  <柱> <案件> はIDの先頭数文字でも、名前の一部でも通ります。
  日付は 今日 / 明日 / 3日後 / 8-20 / 2026-08-20 が使えます。
  金額は 30万 / 300000 が使えます。
`;
