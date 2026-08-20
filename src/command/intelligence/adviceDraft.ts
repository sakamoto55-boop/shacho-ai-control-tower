/**
 * 営業日報・現場報告への「返信アドバイス下書き」を、DecisionCaseの実データから決定論的に組み立てる。
 * - AIに作文で暴走させない。カードの confirmedFacts / missingInformation / aiRecommendation / nextAction のみを使う。
 * - 生成物は必ず「下書き（承認制）」。自動送信はしない（approvalStatus: 'waiting' 固定）。
 * - 金額・契約・納期・謝罪・責任・外注費・労務・事故を断定しない（危険語は確認質問に落とす）。
 */
import type { DecisionCase } from './types.js';

export interface AdviceDraft {
  caseId: string;
  toLabel: string;
  /** 送信文の下書き（承認後に人が送る前提） */
  draft: string;
  /** 何を根拠に作ったか（確認済み事実・不足情報の件数など） */
  basis: { confirmedFacts: number; missingInformation: number; hasRecommendation: boolean };
  approvalStatus: 'waiting';
  /** 断定を避けた注意書き（UIに表示） */
  guard: string;
}

const DANGER = /(金額|見積|値引き|契約|納期|外注|労務|残業|事故|過失|責任|謝罪|賠償|返金)/;

/** 送信者ラベルから宛名（さん付け）を作る。空なら「担当者」 */
function honorific(toLabel: string): string {
  const name = (toLabel || '').trim();
  if (!name || /lineworks|unknown|bot/i.test(name)) return '担当者';
  return /さん$|様$/.test(name) ? name : `${name}さん`;
}

export function buildAdviceDraft(c: DecisionCase, toLabel: string): AdviceDraft {
  const to = honorific(toLabel);
  const lines: string[] = [];
  lines.push(`${to}、報告ありがとうございます。`);

  // 要点（確認できた事実のみ。無ければ本文要約）
  const facts = (c.confirmedFacts ?? []).filter((f) => f && f.trim());
  if (facts.length) {
    lines.push('【受け取った要点】');
    for (const f of facts.slice(0, 4)) lines.push(`・${f}`);
  } else if (c.whatHappened) {
    lines.push(`内容を確認しました：${c.whatHappened.slice(0, 80)}`);
  }

  // 不足情報 → 確認質問（推測で埋めない。危険語もここで確認に落とす）
  const missing = (c.missingInformation ?? []).filter((m) => m && m.trim());
  if (missing.length) {
    lines.push('【確認させてください】');
    for (const m of missing.slice(0, 4)) lines.push(`・${m}`);
  }

  // 次アクション（カードの推奨/次アクションから。断定を避ける）
  const next = (c.presidentNextAction || c.aiRecommendation || '').trim();
  if (next && !DANGER.test(next)) {
    lines.push(`【次の動き（案）】${next}`);
  } else if (next) {
    // 危険語を含む次アクションは「確認のうえ進める」に丸める
    lines.push('【次の動き（案）】上記の確認が取れ次第、こちらで判断して指示します。');
  }

  lines.push('不明点や急ぎの事情があれば、このまま返信してください。');

  return {
    caseId: c.caseId,
    toLabel,
    draft: lines.join('\n'),
    basis: {
      confirmedFacts: facts.length,
      missingInformation: missing.length,
      hasRecommendation: Boolean(c.aiRecommendation)
    },
    approvalStatus: 'waiting',
    guard:
      '※これは下書きです。金額・契約・納期・謝罪・責任は確定していません。社長の承認後に送信してください（自動送信はしません）。'
  };
}
