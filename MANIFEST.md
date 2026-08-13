# MANIFEST — LCC COMMAND（CODEX是正版 / REVIEW CANDIDATE）

- applicationCodeCommit: **66813db67ac40530e0f793d410b579250dec0cba**（branch claude/lcc-command-ui-voice-v1・テスト対象SHAと一致）
- 旧記載（b6c48b0・snap-aaba8a1e3f・V1A delivery v4）は HISTORICAL。旧配布ZIP群の記録は
  Documents\LCC_V1A_ACCEPTANCE_20260810 に保全（成果物自体は無変更）
- 本版の主対象: EXECUTIVE COMMAND CENTER UI・端末ペアリング認証・実データ接続
  （freee LIVE_API / Sheets系 SHEET_INGESTED / Drive LIVE_API metadata READ ONLY）
- テスト: vitest 509件 / lint 0 errors / tsc PASS / npm audit high・critical 0（moderate 2）
- 成果物: LCC_COMMAND_CODE_<短縮SHA>.zip（git archive）+ lcc-command-<短縮SHA>.bundle（履歴検証用）
  + 各SHA-256 sidecar。token・.env・secure・vault・実データは含まない
- generatedAt: 2026-08-13T13:37:50.860Z
