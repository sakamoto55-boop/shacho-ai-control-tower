import 'dotenv/config';
import cron from 'node-cron';
import { runEmailAlertJob, type AlertSlot } from './jobs/emailAlertJob.js';
import { generateAndSendReport } from './jobs/generateReports.js';
import { createRepository } from './repositories/createRepository.js';

const repository = createRepository();

async function runAlertSlot(slot: AlertSlot) {
  console.log(`[Scheduler] メールアラート開始: ${slot}`);
  try {
    const result = await runEmailAlertJob(repository, slot);
    console.log(
      `[Scheduler] 完了 - ${result.processedCount}件処理, A優先:${result.priorityACounts}件` +
        (result.savedPath ? `, 保存先: ${result.savedPath}` : '')
    );
    if (result.errors.length > 0) {
      console.warn(`[Scheduler] エラー:`, result.errors);
    }
  } catch (err) {
    console.error(`[Scheduler] メールアラート失敗 (${slot}):`, err);
  }
}

async function runReport(kind: 'morning' | 'noon' | 'evening') {
  console.log(`[Scheduler] レポート生成: ${kind}`);
  try {
    await generateAndSendReport(repository, kind);
  } catch (err) {
    console.error(`[Scheduler] レポート生成失敗 (${kind}):`, err);
  }
}

export function startScheduler() {
  const tz = 'Asia/Tokyo';

  // 朝 8:00 JST
  cron.schedule('0 8 * * *', () => void runAlertSlot('morning'), { timezone: tz });
  cron.schedule('5 8 * * *', () => void runReport('morning'), { timezone: tz });

  // 昼 12:30 JST
  cron.schedule('30 12 * * *', () => void runAlertSlot('noon'), { timezone: tz });
  cron.schedule('35 12 * * *', () => void runReport('noon'), { timezone: tz });

  // 夕 18:00 JST
  cron.schedule('0 18 * * *', () => void runAlertSlot('evening'), { timezone: tz });
  cron.schedule('5 18 * * *', () => void runReport('evening'), { timezone: tz });

  console.log('[Scheduler] 起動完了 — 朝08:00 / 昼12:30 / 夕18:00 (JST) にアラートを送信します');
}

// スタンドアロン起動
if (import.meta.url === `file://${process.argv[1]}`) {
  startScheduler();
  console.log('[Scheduler] スタンドアロンモードで実行中。Ctrl+C で終了。');
}
