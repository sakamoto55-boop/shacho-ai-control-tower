/**
 * LLMフック生成（Phase B1 §7-§8）。
 *
 * ANTHROPIC_API_KEY設定時のみ、LLMによるMemory候補抽出（Curator v2）と
 * 追加検証（Critic v2）を有効化する。いずれもLLMは「提案のみ」で、
 * 保存可否はLearning Safety、検証の最終判定は決定論Criticが行う。
 * 出力はJSONを要求し、パース不能なら黙って空を返す（会話は止めない）。
 */
import type { LlmCandidateExtractor, LlmMemoryCandidate } from '../memory/curator.js';
import type { CriticIssue, LlmCriticAdvisor } from '../agents/critic.js';
import { AnthropicCommandModelProvider } from './generalReasoner.js';

const CURATOR_SYSTEM = [
  'あなたは会話から記憶候補を抽出する抽出器です。JSON配列のみを出力してください。',
  '各要素: {"type":"FACT|DECISION|OPINION|HYPOTHESIS|PROBLEM|PREFERENCE|COMMITMENT|CONTEXT","statement":"..."}',
  '- 意見・印象はFACTにしない（OPINION/HYPOTHESIS）。',
  '- 給与・口座・個人情報は抽出しない。',
  '- 抽出すべきものがなければ [] を出力。'
].join('\n');

const CRITIC_SYSTEM = [
  'あなたは経営AIの回答を検証するレビュアーです。JSON配列のみを出力してください。',
  '各要素: {"issue":"...","severity":"HIGH|MEDIUM|LOW","recommendation":"..."}',
  '- 回答の書き換えは行わない。指摘のみ。',
  '- 問題がなければ [] を出力。'
].join('\n');

function parseJsonArray<T>(raw: string): T[] {
  try {
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start < 0 || end <= start) return [];
    const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export interface LlmHooks {
  curatorExtractor?: LlmCandidateExtractor;
  criticAdvisor?: LlmCriticAdvisor;
}

export function createLlmHooksFromEnv(env = process.env): LlmHooks {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return {};
  const provider = new AnthropicCommandModelProvider(apiKey);

  const curatorExtractor: LlmCandidateExtractor = async (message) => {
    const raw = await provider.complete({ systemPrompt: CURATOR_SYSTEM, userMessage: message });
    return parseJsonArray<LlmMemoryCandidate>(raw).filter(
      (c) => typeof c?.statement === 'string' && typeof c?.type === 'string'
    );
  };

  const criticAdvisor: LlmCriticAdvisor = async (draft, originalMessage) => {
    const raw = await provider.complete({
      systemPrompt: CRITIC_SYSTEM,
      userMessage: `質問: ${originalMessage}\n\n回答案:\n${draft.text.slice(0, 2000)}`
    });
    return parseJsonArray<CriticIssue>(raw).filter(
      (i) => typeof i?.issue === 'string' && typeof i?.recommendation === 'string'
    );
  };

  return { curatorExtractor, criticAdvisor };
}
