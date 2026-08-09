/**
 * Provider Benchmark（Phase LIVE-AI §12）。
 *
 * 同じEvaluation質問を複数Providerへ投げ、Quality/Latency/Structured Output成功率等を
 * 決定論的に記録する。結果は将来のRouter選択（Provider性能学習）に使う。
 * 少数サンプルへの過適合を避けるため、判定はスコアではなく生データとして保存する。
 */
import type { CommandModelProvider } from '../ai/ModelRouter.js';

export interface BenchmarkQuestion {
  id: string;
  question: string;
  /** structured: JSON出力を要求し、パース可否を測る */
  structured?: boolean;
  /** 回答に含まれるべき語（正確性の簡易判定） */
  expectText?: string[];
}

export interface ProviderBenchmarkRecord {
  providerId: string;
  questionId: string;
  ok: boolean;
  latencyMs: number;
  answerLength: number;
  structuredOk?: boolean;
  accuracyOk?: boolean;
  error?: string;
}

export interface ProviderBenchmarkReport {
  records: ProviderBenchmarkRecord[];
  summary: Array<{
    providerId: string;
    total: number;
    okRate: number;
    avgLatencyMs: number;
    structuredOkRate: number | null;
    accuracyRate: number | null;
  }>;
}

export async function runProviderBenchmark(
  providers: CommandModelProvider[],
  questions: BenchmarkQuestion[],
  nowMs: () => number = Date.now
): Promise<ProviderBenchmarkReport> {
  const records: ProviderBenchmarkRecord[] = [];
  for (const provider of providers) {
    for (const q of questions) {
      const started = nowMs();
      try {
        const prompt = q.structured
          ? `${q.question}\n\n必ずJSONオブジェクトのみで回答してください。`
          : q.question;
        const answer = await provider.complete({
          purpose: 'analysis',
          systemPrompt: 'あなたは評価用の応答者です。簡潔に正確に答えてください。',
          userMessage: prompt
        });
        const latencyMs = nowMs() - started;
        let structuredOk: boolean | undefined;
        if (q.structured) {
          try {
            const start = answer.indexOf('{');
            const end = answer.lastIndexOf('}');
            JSON.parse(answer.slice(start, end + 1));
            structuredOk = true;
          } catch {
            structuredOk = false;
          }
        }
        const accuracyOk = q.expectText ? q.expectText.every((t) => answer.includes(t)) : undefined;
        records.push({
          providerId: provider.providerId,
          questionId: q.id,
          ok: answer.length > 0,
          latencyMs,
          answerLength: answer.length,
          structuredOk,
          accuracyOk
        });
      } catch (error) {
        records.push({
          providerId: provider.providerId,
          questionId: q.id,
          ok: false,
          latencyMs: nowMs() - started,
          answerLength: 0,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  const summary = providers.map((provider) => {
    const own = records.filter((r) => r.providerId === provider.providerId);
    const structured = own.filter((r) => r.structuredOk !== undefined);
    const accuracy = own.filter((r) => r.accuracyOk !== undefined);
    return {
      providerId: provider.providerId,
      total: own.length,
      okRate: own.length ? own.filter((r) => r.ok).length / own.length : 0,
      avgLatencyMs: own.length ? Math.round(own.reduce((s, r) => s + r.latencyMs, 0) / own.length) : 0,
      structuredOkRate: structured.length
        ? structured.filter((r) => r.structuredOk).length / structured.length
        : null,
      accuracyRate: accuracy.length ? accuracy.filter((r) => r.accuracyOk).length / accuracy.length : null
    };
  });

  return { records, summary };
}
