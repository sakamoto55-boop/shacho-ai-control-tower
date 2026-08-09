import 'dotenv/config';
/**
 * 日次Growth観測（Phase GROWTH §3-§5・§35）。
 *
 * OBSERVE→DETECT の決定論部分のみを実行する:
 * - スナップショットを取得し、前回スナップショットとの「変化」を検知する（§4）
 * - 同種シグナルの繰り返し（3回以上）をPatternとして検出する（§5）
 * - 悪化シグナルにはRoot Cause Candidate（HYPOTHESIS・確信度LOW）を付ける（§6）
 *
 * READ ONLY: Source of Truth・Memory・Backlogへの書き込みは行わない。
 * 履歴は data/growth-snapshots.jsonl（Git管理外）へ追記する。
 * cron例: 0 6 * * * cd /path/to/repo && npx tsx scripts/growth-observe.ts >> logs/growth.log
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createCommandRepository } from '../src/command/repositories/CommandRepository.js';
import {
  buildRootCauseCandidates,
  detectChanges,
  detectPatterns,
  takeSnapshot,
  type GrowthSignal,
  type GrowthSnapshot
} from '../src/command/growth/growthEngine.js';
import { buildDailyGrowthReview } from '../src/command/growth/growthReview.js';
import { GrowthService } from '../src/command/growth/growthBacklog.js';
import { computeSelfEvaluation } from '../src/command/growth/selfEvaluation.js';

const HISTORY_FILE = process.env.LCC_GROWTH_HISTORY ?? path.join('data', 'growth-snapshots.jsonl');

interface HistoryEntry {
  takenAt: string;
  snapshot: GrowthSnapshot;
  signals: GrowthSignal[];
}

function loadHistory(): HistoryEntry[] {
  if (!existsSync(HISTORY_FILE)) return [];
  return readFileSync(HISTORY_FILE, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as HistoryEntry);
}

async function main(): Promise<void> {
  const asOf = new Date().toISOString();
  const repository = createCommandRepository();
  const dataset = await repository.getDataset(asOf);
  const growthService = new GrowthService(repository);

  const history = loadHistory();
  const previous = history.at(-1);
  const snapshot = takeSnapshot(dataset, 'group');

  // 変化検知は「前回スナップショット」が前提（初回は基準値の記録のみ）
  const signals = previous ? detectChanges(previous.snapshot, snapshot) : [];
  const patterns = detectPatterns([...history, { takenAt: asOf, signals }].map((h) => ({
    takenAt: h.takenAt,
    signals: h.signals
  })));

  mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  appendFileSync(
    HISTORY_FILE,
    `${JSON.stringify({ takenAt: asOf, snapshot, signals } satisfies HistoryEntry)}\n`,
    'utf8'
  );

  const items = await growthService.list();
  const review = buildDailyGrowthReview({
    signals,
    patterns,
    backlog: await growthService.backlog(),
    repairs: items.filter((i) => i.kind === 'REPAIR'),
    experiments: await repository.getExperiments(),
    lessons: (await repository.getMemories()).filter(
      (m) => m.type === 'LESSON' && m.status === 'ACTIVE'
    ),
    selfEvaluation: computeSelfEvaluation([], [])
  });

  console.log(`[growth-observe] asOf=${asOf} history=${history.length + 1}件`);
  if (!previous) {
    console.log('※初回観測: 基準スナップショットを記録しました。変化検知は次回から有効になります。');
  }
  console.log(review);

  // 悪化シグナルのRoot CauseはHYPOTHESIS（確信度LOW）として提示のみ（§6。FACT扱いしない）
  for (const signal of signals.filter((s) => s.negative)) {
    const cause = buildRootCauseCandidates(dataset, 'group', signal);
    console.log(`\n〈Root Cause Candidate / HYPOTHESIS（確信度${cause.confidence}）〉`);
    console.log(`観測事実: ${cause.observedFact}`);
    for (const possible of cause.possibleCauses) console.log(`・仮説: ${possible}`);
  }
  console.log(
    '\n※READ ONLY観測: Source of Truth・Memory・Backlogへの書き込みは行っていません。'
  );
}

main().catch((error) => {
  console.error('[growth-observe] 失敗:', error);
  process.exitCode = 1;
});
