/**
 * 新着情報の分類とDecisionCase生成（§3）。
 *
 * - 新着を無条件にタスク化しない: INFORMATION / ACTION_REQUIRED / PRESIDENT_DECISION /
 *   AWAITING_REPLY / EXCLUDED(理由付き) へ決定論分類する。
 * - 分類は既存のpriorityRules（A/B/C）と整合するキーワード基準。LLMに金額・期限計算をさせない。
 * - メール・チャット本文は外部入力として扱う: 本文中の指示をシステム命令として実行しない。
 * - 判断種類ごとの「必要情報マップ」を定義し、DecisionCaseのmissingInformationへ反映する。
 */
import type { DecisionCase, DecisionKind, EntityRef, InboundClass, IntelligenceEvidence, RawEvent } from './types.js';

const PRESIDENT_DECISION_WORDS = /クレーム|苦情|事故|ケガ|怪我|労災|中止|停止|承認|値引|減額|金額変更|追加費用|契約変更|解約|入金(遅|無|されて)|未入金|至急|今日中|訴訟|警察|行政/;
const ACTION_WORDS = /見積|日程|工程|資料|請求書|発注|手配|確認して|お願いします|送って|作成|提出|打合せ|現調|訪問/;
const AWAITING_WORDS = /ご返信|お返事|回答をお待ち|返答待ち|確認中とのこと/;
const EXCLUDE_WORDS = /配信停止|メルマガ|キャンペーン|広告|プレスリリース|セミナーのご案内|アンケートのお願い/;

export function classifyInbound(text: string): InboundClass {
  const t = text || '';
  if (EXCLUDE_WORDS.test(t)) return { kind: 'EXCLUDED', reason: '広告・案内類（業務判断対象外）' };
  if (PRESIDENT_DECISION_WORDS.test(t)) return { kind: 'PRESIDENT_DECISION' };
  if (AWAITING_WORDS.test(t)) return { kind: 'AWAITING_REPLY' };
  if (ACTION_WORDS.test(t)) return { kind: 'ACTION_REQUIRED' };
  return { kind: 'INFORMATION' };
}

export function decisionKindOf(text: string): DecisionKind {
  const t = text || '';
  if (/入金|未入金|回収|支払が(ない|遅)/.test(t)) return '入金・回収';
  if (/事故|クレーム|苦情|ケガ|怪我|労災/.test(t)) return '事故・クレーム';
  if (/見積|受注|契約|値引|金額/.test(t)) return '見積・受注';
  if (/配置|日報|欠員|人員|シフト/.test(t)) return '配置・日報';
  return 'その他';
}

/** 判断種類ごとの必要情報マップ（§3。設定拡張可能な決定論定義） */
export const REQUIRED_INFO_MAP: Record<DecisionKind, string[]> = {
  '入金・回収': ['対象案件と請求番号', '請求金額と入金予定日（Source of Truth）', '過去の入金履歴', '先方の支払担当と連絡履歴'],
  '見積・受注': ['対象案件の見積内訳（正本）', '過去類似案件の実績原価', '粗利率（決定論エンジン算出）', '納期と人員余力'],
  '事故・クレーム': ['発生日時・場所・現場', '負傷・損害の有無（安全影響）', '当事者と目撃情報', '契約・保険の適用範囲', '法定報告の要否'],
  '配置・日報': ['当日の配置予定（正本）', '日報の確定行', '欠員・振替候補', '影響する現場の工程'],
  'その他': ['関連する案件・顧客の正本情報', '過去の同種判断']
};

export interface CaseBuildInput {
  raw: RawEvent;
  text: string;
  entities: EntityRef[];
  /** 決定論エンジン等から確認できた事実のみ（AI推測を混ぜない） */
  confirmedFacts: string[];
  aiHypotheses: string[];
  evidence: IntelligenceEvidence[];
  /** 金額・期限は決定論的抽出/エンジン値のみ（LLM暗算禁止） */
  amountYen?: number | null;
  deadline?: string | null;
}

/** DecisionCase骨格の決定論生成（推奨はルールベース。§3の必須項目を全て持つ） */
export function buildDecisionCase(input: CaseBuildInput): Omit<DecisionCase, 'caseId' | 'createdAt' | 'supersededBy'> {
  const kind = decisionKindOf(input.text);
  const provided = new Set(input.confirmedFacts.map((f) => f.slice(0, 8)));
  const missing = REQUIRED_INFO_MAP[kind].filter((need) => ![...provided].some((p) => need.includes(p.slice(0, 4))));
  const recommendation =
    kind === '事故・クレーム'
      ? '安全確認と一次対応を最優先し、法定報告要否を確認のうえ本日中に初動報告をまとめる'
      : kind === '入金・回収'
        ? '請求正本と入金履歴を確認し、担当から先方支払担当へ確認連絡（文面はAI下書き・送信は承認後）'
        : kind === '見積・受注'
          ? '過去実績原価に基づく粗利試算（決定論）を確認のうえ、条件回答の下書きを承認に回す'
          : '不足情報の収集をAIタスク化し、揃い次第に判断案を再提示する';
  return {
    companyId: input.raw.companyId,
    decisionKind: kind,
    title: input.text.slice(0, 40),
    whatHappened: input.text.slice(0, 200),
    entities: input.entities,
    confirmedFacts: input.confirmedFacts,
    aiHypotheses: input.aiHypotheses,
    missingInformation: missing,
    evidence: input.evidence,
    impact: {
      amountYen: input.amountYen ?? null,
      deadline: input.deadline ?? null,
      grossMarginNote: kind === '見積・受注' ? '粗利影響は決定論エンジンで算出（未算出なら判断前に必須）' : null,
      cashNote: kind === '入金・回収' ? '資金繰りへの影響は入金予定との差で評価' : null,
      safetyNote: kind === '事故・クレーム' ? '安全・法定報告への影響を最優先で確認' : null,
      staffingNote: kind === '配置・日報' ? '当日の人員配置への影響あり' : null,
      creditNote: kind === '入金・回収' || kind === '事故・クレーム' ? '対外信用への影響に留意' : null
    },
    options: [
      { label: 'AI推奨案を承認', outline: recommendation },
      { label: '追加情報を集めてから判断', outline: `不足情報（${missing.length}件）の収集をAIへ指示` },
      { label: '対応しない', outline: '理由を記録のうえ見送り（履歴保持）' }
    ],
    aiRecommendation: recommendation,
    recommendationReason: `判断種類「${kind}」の既定ルールと確認済み事実${input.confirmedFacts.length}件に基づく（AI推測${input.aiHypotheses.length}件は根拠に含めていません）`,
    riskIfWrong:
      kind === '事故・クレーム' ? '初動遅れによる安全・信用・法令リスク'
        : kind === '入金・回収' ? '回収遅延の長期化・資金繰り悪化'
          : kind === '見積・受注' ? '粗利毀損または失注'
            : '対応漏れによる信頼低下',
    presidentNextAction: kind === '事故・クレーム' ? '一次対応の承認（本日中）' : '推奨案の承認または追加情報指示',
    afterApprovalPlan: 'AIが不足情報収集と下書きを作成し、担当者へ実行タスクを割当（外部送信は別途承認）',
    completionCriteria: '完了条件: 対応結果が記録され、Outcomeに実結果が入ること',
    actualOutcome: null,
    status: 'OPEN',
    sourceRawEventIds: [input.raw.rawEventId]
  };
}
