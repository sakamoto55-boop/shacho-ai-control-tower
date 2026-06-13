import { classifyPriority } from '../../domain/priorityRules.js';
import { detectRisk } from '../../domain/riskRules.js';
import type {
  AnalyzeMessageInput,
  AnalyzeMessageResult,
  AnalyzeReplyDraftResult,
  AnalyzeTaskResult,
  OwnerType,
  ReplyTone
} from '../../domain/types.js';
import { parseJapaneseDueDate } from '../../utils/date.js';
import { normalizeText } from '../../utils/textNormalize.js';
import type { AIProvider } from './AIProvider.js';

const includesAny = (text: string, words: string[]) => words.some((word) => text.includes(word));

const dangerousReplyWords = [
  '金額',
  '値引',
  '契約',
  '納期',
  '謝罪',
  '申し訳',
  'クレーム',
  '外注費',
  '支払',
  '入金',
  '採用',
  '退職',
  '労務',
  '事故',
  '責任'
];

/**
 * chatHistoryが提供された場合、最後の発言者が社長かどうかを判定する。
 * 社長が最後に発言していれば返信不要。
 */
function isLastSenderPresident(input: AnalyzeMessageInput): boolean {
  if (!input.chatHistory || input.chatHistory.length === 0) return false;
  const last = input.chatHistory[input.chatHistory.length - 1];
  return last.senderType === 'president';
}

/**
 * chatHistoryから相手（other）のメッセージだけを結合して分析用テキストを作成する。
 * 社長（president）の発言は背景情報として含めない。
 */
function extractOtherMessagesText(input: AnalyzeMessageInput): string {
  if (!input.chatHistory || input.chatHistory.length === 0) {
    return input.text;
  }
  const otherMessages = input.chatHistory
    .filter((msg) => msg.senderType === 'other')
    .map((msg) => msg.text)
    .join(' ');
  return otherMessages || input.text;
}

function detectOwnerType(text: string): OwnerType {
  const normalized = text.toLowerCase();
  if (includesAny(normalized, ['見積', '受注', '顧客', '営業', '相見積'])) return 'sales';
  if (includesAny(normalized, ['現場', '作業', '工務', '職人', '人員', '外注', '写真', '配置', '資材', '工期'])) return 'construction';
  if (includesAny(normalized, ['請求', '入金', '支払', '経理', '書類', '請求書', '振込'])) return 'backoffice';
  if (includesAny(normalized, ['協力会社', '外注先', '応援', '業者'])) return 'partner';
  if (includesAny(normalized, ['社長', '承認', '値引', '契約条件', '今日決め', '社長確認'])) return 'president';
  return 'unknown';
}

function detectReplyTone(input: AnalyzeMessageInput, riskType: string): ReplyTone {
  if (riskType === 'complaint' || riskType === 'accident') return 'apology_careful';
  // 協力会社・外注先はソースより内容で判定（lineworks経由でもpartner_requestになる）
  if (includesAny(input.text, ['協力会社', '外注', '応援', '業者'])) return 'partner_request';
  if (input.source === 'lineworks') return 'internal_instruction';
  if (input.source === 'external_forward') return 'external_polite';
  if (includesAny(input.text, ['確認しました', '共有します', '承知', '了解', 'ありがとう'])) return 'confirmation_only';
  return 'external_polite';
}

function extractProjectName(text: string): string {
  const candidates = [
    text.match(/([A-ZＡ-Ｚa-zａ-ｚ0-9０-９一-龠ぁ-んァ-ンー]+(?:現場|工事|案件|外構|解体|不動産|福祉|施設))/),
    text.match(/([A-ZＡ-Ｚa-zａ-ｚ0-9０-９一-龠ぁ-んァ-ンー]+様?邸)/),
    text.match(/([A-ZＡ-Ｚa-zａ-ｚ0-9０-９一-龠ぁ-んァ-ンー]+社)/)
  ];
  return candidates.find((match) => match?.[1])?.[1] ?? '';
}

function extractCustomerName(text: string, senderName: string): string {
  const customer = text.match(/([A-ZＡ-Ｚa-zａ-ｚ0-9０-９一-龠ぁ-んァ-ンー]+(?:社|様|会社|さん))/);
  if (customer?.[1]) return customer[1];
  return senderName || '';
}

function buildSummary(input: AnalyzeMessageInput, text: string, priority: string): string {
  const subjectPart = input.subject ? `「${input.subject}」` : '';
  const roomPart = input.roomName ? `[${input.roomName}]` : '';
  const sliced = text.length > 60 ? `${text.slice(0, 60)}…` : text;
  return `${roomPart}${subjectPart}${sliced} [優先度:${priority}]`;
}

function buildTasks(input: AnalyzeMessageInput, priority: 'A' | 'B' | 'C', analysisText: string): AnalyzeTaskResult[] {
  const text = normalizeText(analysisText);
  const risk = detectRisk(text);
  let ownerType = detectOwnerType(text);
  if (priority === 'A' && risk.level === 'high' && !['payment_delay'].includes(risk.type)) {
    ownerType = 'president';
  }
  const due = parseJapaneseDueDate(text);

  // 完了報告・情報共有のみの場合はタスク不要
  if (priority === 'C' && includesAny(text, ['完了', '共有済み', '報告', '作業完了', '写真も共有'])) {
    return [];
  }

  let taskTitle = '内容を確認する';
  let taskDetail = text.length > 100 ? `${text.slice(0, 100)}…` : text;
  let nextAction = '担当者を決め、必要な確認を行う';

  if (includesAny(text, ['見積'])) {
    taskTitle = '見積対応を進める';
    taskDetail = '見積依頼内容を確認し、必要に応じて現地確認または原価確認を行う。まず予算感を確認すること。';
    nextAction = '営業部へ見積作成を依頼する（先に予算感を確認）';
  } else if (includesAny(text, ['入金', '未入金', '支払予定日', '振込'])) {
    taskTitle = '入金状況を確認する';
    taskDetail = '予定入金と実入金を照合し、必要に応じて確認連絡を行う。';
    nextAction = '業務サポート部で入金状況を確認する';
  } else if (includesAny(text, ['外注', '人員', '作業が止', '現場が止', '配置', '応援'])) {
    taskTitle = '現場継続に必要な手配を確認する';
    taskDetail = '外注費、人員、工程影響を確認し、社長判断が必要な事項を整理する。';
    nextAction = priority === 'A' ? '社長へ承認可否を確認する' : '工務部へ手配状況を確認する';
  } else if (includesAny(text, ['クレーム', '怒', '苦情', '折り返し', '不満'])) {
    taskTitle = 'クレーム予兆の事実確認を行う';
    taskDetail = '相手の不満内容、事実関係、次の回答期限を整理する。';
    nextAction = '事実確認後、社長確認のうえ返信する';
  } else if (includesAny(text, ['総会', '会議', '定例', 'MTG', 'ミーティング'])) {
    taskTitle = '会議・総会への参加可否を確認する';
    taskDetail = '日時・場所・議題を確認し、参加可否と準備事項を整理する。';
    nextAction = '参加可否を返信し、必要な準備を担当者に指示する';
  } else if (includesAny(text, ['入居', '退去', '管理費', '賃料', '物件'])) {
    taskTitle = '不動産管理対応を確認する';
    taskDetail = '入退去・賃料・管理費に関する確認事項を整理する。';
    nextAction = '担当者へ確認・対応を依頼する';
  } else if (includesAny(text, ['利用者', 'ケア', '施設', '福祉', '介護'])) {
    taskTitle = '福祉事業の対応を確認する';
    taskDetail = '利用者・施設に関する確認事項を整理する。';
    nextAction = '担当者へ確認・対応を依頼する';
  }

  return [
    {
      taskTitle,
      taskDetail,
      ownerType,
      ownerName: '',
      dueDate: due.dueDate,
      dueDateText: due.dueDateText,
      priority,
      requiresPresident: priority === 'A',
      nextAction,
      reason: risk.type !== 'none' ? risk.reason : '本文から業務上の対応が必要と判断しました。'
    }
  ];
}

function buildReplyDraft(input: AnalyzeMessageInput, riskType: string, analysisText: string, lastSenderIsPresident: boolean): AnalyzeReplyDraftResult {
  // 社長が最後に発言していれば返信不要
  if (lastSenderIsPresident) {
    return {
      needed: false,
      text: '',
      tone: 'confirmation_only',
      confirmationNeeded: [],
      ngReasons: ['社長（自分）が最後に発言済みのため返信不要です。']
    };
  }

  const text = normalizeText(analysisText);
  const needed = includesAny(text, [
    'お願いします',
    'お願いできますか',
    'お願いいたします',
    'ください',
    'いただけますか',
    'いただけますでしょうか',
    '確認',
    '依頼',
    '至急',
    '返答',
    '返信',
    '折り返し',
    '見積',
    '参加',
    '可否',
    '教えて',
    '報告',
    '判断',
    '希望します',
    '希望いたします'
  ]);
  const tone = detectReplyTone(input, riskType);
  const ngReasons = dangerousReplyWords
    .filter((word) => text.includes(word))
    .map((word) => `${word}に関わるため自動送信は禁止です。`);

  if (riskType === 'complaint') {
    ngReasons.push('クレーム予兆のため自動送信は禁止です。');
  }

  if (riskType === 'accident') {
    ngReasons.push('事故・安全に関わるため自動送信は禁止です。');
  }

  const confirmationNeeded: string[] = [];
  if (ngReasons.length > 0) confirmationNeeded.push('社長または責任者の確認が必要です。');
  if (includesAny(text, ['金額', '値引', '外注費', '追加費用'])) confirmationNeeded.push('金額・原価・粗利影響の確認');
  if (includesAny(text, ['納期', '工程', '明日'])) confirmationNeeded.push('工程・人員の実現可否確認');
  if (riskType === 'complaint') confirmationNeeded.push('事実関係と相手の要望確認');

  if (!needed) {
    return {
      needed: false,
      text: '',
      tone: 'confirmation_only',
      confirmationNeeded: [],
      ngReasons: []
    };
  }

  let draft = 'ご連絡ありがとうございます。内容を確認のうえ、必要事項を整理して回答いたします。';

  if (tone === 'internal_instruction') {
    draft = '内容確認しました。担当者を決めて、期限と次アクションを整理してください。必要に応じて社長確認へ回してください。';
  } else if (tone === 'partner_request') {
    draft = 'ご連絡ありがとうございます。内容を確認します。対応可否、必要人数、希望時間、費用条件を整理のうえ回答いたします。';
  } else if (tone === 'apology_careful') {
    draft = 'ご連絡ありがとうございます。まず事実関係を確認いたします。確認後、対応方針と次のご連絡時刻を改めてお伝えいたします。';
  } else if (includesAny(text, ['見積'])) {
    draft = 'ご連絡ありがとうございます。見積内容を確認し、必要に応じて現地・原価を確認のうえ回答いたします。まずご予算感をお聞かせいただけますか？';
  } else if (includesAny(text, ['総会', '会議', '定例', 'MTG'])) {
    draft = 'ご連絡ありがとうございます。日程を確認し、参加可否をお伝えいたします。';
  }

  return {
    needed: true,
    text: draft,
    tone,
    confirmationNeeded,
    ngReasons
  };
}

export class MockAIProvider implements AIProvider {
  async analyzeMessage(input: AnalyzeMessageInput): Promise<AnalyzeMessageResult> {
    // chatHistoryがある場合、相手のメッセージのみを分析対象にする
    const analysisText = extractOtherMessagesText(input);
    const text = normalizeText(analysisText);
    const lastSenderIsPresident = isLastSenderPresident(input);

    const risk = detectRisk(text);
    const priority = classifyPriority(text, risk);
    const replyDraft = buildReplyDraft(input, risk.type, analysisText, lastSenderIsPresident);
    const tasks = buildTasks(input, priority, analysisText);

    return {
      summary: buildSummary(input, text, priority),
      projectName: extractProjectName(text),
      customerName: extractCustomerName(text, input.senderName),
      priority,
      replyNeeded: replyDraft.needed,
      tasks,
      replyDraft,
      risk,
      confidence: text.length > 15 ? 'medium' : 'low'
    };
  }
}
