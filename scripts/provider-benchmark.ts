/**
 * Provider Benchmark実行（Phase LIVE-AI §12）。
 * 設定済みの実Providerへ同一質問を投げ、Latency/Structured成功率等を比較する。
 * API Key未設定Providerはスキップ（NOT_CONFIGUREDの正常状態）。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import type { CommandModelProvider } from '../src/command/ai/ModelRouter.js';
import { AnthropicCommandModelProvider } from '../src/command/ai/generalReasoner.js';
import {
  GeminiCommandModelProvider,
  OpenAICommandModelProvider
} from '../src/command/ai/liveProviders.js';
import {
  runProviderBenchmark,
  type BenchmarkQuestion
} from '../src/command/evaluation/providerBenchmark.js';

const QUESTIONS: BenchmarkQuestion[] = [
  { id: 'b-1', question: '建設業の粗利率とは何かを2文で説明してください。', expectText: ['粗利'] },
  { id: 'b-2', question: '{"a":1,"b":2} の a と b の合計を {"sum": 数値} 形式で返してください。', structured: true },
  { id: 'b-3', question: '「安全第一。工期が遅れても安全を犠牲にしない」という方針の意図を1文で述べてください。' }
];

async function main(): Promise<void> {
  const providers: CommandModelProvider[] = [];
  if (process.env.ANTHROPIC_API_KEY) providers.push(new AnthropicCommandModelProvider(process.env.ANTHROPIC_API_KEY));
  if (process.env.OPENAI_API_KEY) providers.push(new OpenAICommandModelProvider(process.env.OPENAI_API_KEY));
  if (process.env.GEMINI_API_KEY) providers.push(new GeminiCommandModelProvider(process.env.GEMINI_API_KEY));
  if (providers.length === 0) {
    console.log('[benchmark] 実Providerが未設定です（ANTHROPIC/OPENAI/GEMINIのAPI Keyを設定後に実行してください）');
    process.exitCode = 1;
    return;
  }
  const report = await runProviderBenchmark(providers, QUESTIONS);
  await mkdir('data', { recursive: true });
  await writeFile('data/provider-benchmark.json', JSON.stringify(report, null, 2), 'utf8');
  for (const s of report.summary) {
    console.log(
      `${s.providerId}: ok=${Math.round(s.okRate * 100)}% latency=${s.avgLatencyMs}ms structured=${s.structuredOkRate === null ? '-' : Math.round(s.structuredOkRate * 100) + '%'}`
    );
  }
}

main().catch((error) => {
  console.error('[benchmark] 失敗:', error);
  process.exitCode = 1;
});
