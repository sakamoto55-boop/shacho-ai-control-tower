/**
 * 実戦質問セット（LIVE BETA §4-§5）。
 *
 * - BATTLE_QUESTIONS: §5の必須19問（連続会話として実行する順序を保持）
 * - CONTINUOUS_30: 30ターン連続会話試験（Context Retention検査用）
 * - buildRealEval100: 実データ100問評価セット（カテゴリ×スコープの決定論生成）
 *
 * Synthetic（demoモード・npm test）と実データ（npm run command:real-eval）の
 * 両方で同じセットを使い、接続前後で挙動を比較できるようにする。
 */
import type { CompanyScope } from '../domain/types.js';
import type { RealEvalQuestion } from '../evaluation/realEval.js';
import { HALLUCINATION_PROBES } from '../evaluation/realEval.js';

/** §5の必須実戦質問（この順で連続実行する。文脈依存の質問を含む） */
export const BATTLE_QUESTIONS: string[] = [
  '今日会社どう？',
  '何が一番危ない？',
  'なんで？',
  '根拠は？',
  '本当に？',
  '前に似たケースあった？',
  'その時どうした？',
  '結果は？',
  '今回はどうする？',
  'もっと大胆に',
  'それ覚えて',
  'いや今のは違う',
  'それを正式方針にする',
  'この案件の資料どこ？',
  'この会社調べて',
  '見積案作って',
  'プレゼン作って',
  'Excelにして',
  'この業務アプリにできる？'
];

/** 30ターン連続会話（§4）。実戦19問 + 経営読み取り・記憶・未来系11問 */
export const CONTINUOUS_30: string[] = [
  ...BATTLE_QUESTIONS,
  '今月どう？',
  '現金大丈夫？',
  '請求漏れてない？',
  '営業で漏れてるのは？',
  '来月仕事足りる？',
  '3か月後どうなる？',
  '今日何を覚えた？',
  '会社で何が改善した？',
  '次に何を改善すべき？',
  '会社の原則は？',
  'おはよう'
];

const READ_TEMPLATES: Array<{ category: string; question: string; expectAnswerable: boolean }> = [
  { category: 'brief', question: 'おはよう', expectAnswerable: true },
  { category: 'sales', question: '今月どう？', expectAnswerable: true },
  { category: 'sales', question: '売上どう？', expectAnswerable: true },
  { category: 'sales', question: '来月仕事足りる？', expectAnswerable: true },
  { category: 'risk', question: '一番危ない案件は？', expectAnswerable: true },
  { category: 'risk', question: '危ない現場は？', expectAnswerable: true },
  { category: 'margin', question: '粗利悪化してるのは？', expectAnswerable: true },
  { category: 'leak', question: '営業で漏れてるのは？', expectAnswerable: true },
  { category: 'invoice', question: '請求漏れてない？', expectAnswerable: true },
  { category: 'invoice', question: '未入金どこ？', expectAnswerable: true },
  { category: 'alerts', question: '今日何をすべき？', expectAnswerable: true },
  { category: 'cash', question: '現金大丈夫？', expectAnswerable: false },
  { category: 'cash', question: '資金繰りどう？', expectAnswerable: false },
  { category: 'operations', question: '今日の現場は？', expectAnswerable: false },
  { category: 'operations', question: '昨日誰がどこ行った？', expectAnswerable: false },
  { category: 'future', question: '3か月後どうなる？', expectAnswerable: true },
  { category: 'constitution', question: '会社の原則は？', expectAnswerable: true },
  { category: 'search', question: '経営計画書どこにある？', expectAnswerable: true },
  { category: 'growth', question: '次に何を改善すべき？', expectAnswerable: true },
  { category: 'growth', question: '会社で何が改善した？', expectAnswerable: true },
  { category: 'learning', question: '今日何を覚えた？', expectAnswerable: true },
  { category: 'capability', question: 'プレゼン作って', expectAnswerable: true },
  { category: 'capability', question: '見積案作って', expectAnswerable: true },
  { category: 'estimate', question: '解体の見積案作って', expectAnswerable: true },
  { category: 'targets', question: '目標比どう？', expectAnswerable: false },
  { category: 'memory', question: '前に何の話した？', expectAnswerable: true },
  { category: 'advice', question: 'この判断どう思う？', expectAnswerable: true },
  { category: 'innovation', question: '営業の改善案考えて', expectAnswerable: true },
  { category: 'build', question: '請求チェックを自動化して', expectAnswerable: true },
  { category: 'general', question: '会社として次の一手は？', expectAnswerable: true },
  { category: 'brief', question: 'ブリーフ', expectAnswerable: true },
  { category: 'brief', question: '朝の報告', expectAnswerable: true },
  { category: 'learning', question: '最近何を学んだ？', expectAnswerable: true },
  { category: 'growth', question: '失敗した施策は？', expectAnswerable: true }
];

/**
 * 100問以上の実データ評価セットを決定論で構築する（§4）。
 * READ系テンプレート × スコープ + Hallucination Probes。
 */
export function buildRealEval100(scopes: CompanyScope[] = ['group', 'lcc', 'wel']): RealEvalQuestion[] {
  const questions: RealEvalQuestion[] = [];
  for (const scope of scopes) {
    for (const template of READ_TEMPLATES) {
      questions.push({
        id: `r100-${template.category}-${scope}-${questions.length}`,
        category: template.category,
        question: template.question,
        scope,
        expectAnswerable: template.expectAnswerable
      });
    }
  }
  return [...questions, ...HALLUCINATION_PROBES];
}
