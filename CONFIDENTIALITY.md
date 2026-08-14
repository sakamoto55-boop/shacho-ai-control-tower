# INTERNAL-CONFIDENTIAL（検収ZIP・リポジトリの機密区分）

本リポジトリおよび検収ZIPには、Secret・APIキー・OAuth token・パスワードは含まれない（自動スキャンで確認）。
ただし、以下の**社内識別情報**は運用文書・設定・テストfixtureとして含まれており、「実データ混入0」ではない:

- 実在の人名・会社名（例: 坂本社長、LCC株式会社）
- 業務メールアドレス（例: sakamoto55@lcc55.com）
- Google Drive / Spreadsheet のファイルID・シート名（REAL_DATA_SOURCE_MAP.md・設定・ドキュメント内）
- GCP project ID（lcc-command）・Service Accountメールアドレス

これらは認証情報ではなく単体でアクセス権を与えないが、社内構成を示すため、
本ZIPは **INTERNAL-CONFIDENTIAL** として扱い、検収者（Codex）と社内関係者以外へ共有しないこと。
