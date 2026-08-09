/**
 * Company Constitution Layer（Phase X §2-§8）。
 *
 * 会社として「何を正しいとするか」の最上位原則層。AIが作文するのではなく、
 * 実在資料（経営の聖書 第13期系列・第13期経営計画書PDF・承認済みDecision）を
 * EvidenceとしてREAD ONLY抽出したものを候補（CANDIDATE）として保持する。
 *
 * - AI判断だけでCURRENTにしない。正式性が不明ならCANDIDATE（§5）。
 * - 方針は変更可能: ユーザー判断で旧PrincipleをSUPERSEDEDにし履歴を残す（§8）。
 * - 重要な提案時にAIはこの層を参照し、反する提案には警告を出す（§7・§46）。
 */
import type { Evidence, Principal } from '../domain/types.js';
import type { CommandRepository } from '../repositories/CommandRepository.js';
import { AccessDeniedError } from '../domain/rbac.js';

export type ConstitutionStatus =
  | 'CURRENT'
  | 'CANDIDATE'
  | 'DRAFT'
  | 'SUPERSEDED'
  | 'CONFLICT'
  | 'EXPIRED';

export type ConstitutionCategory =
  | 'VISION'
  | 'MISSION'
  | 'VALUES'
  | 'MANAGEMENT_PRINCIPLE'
  | 'DECISION_PRINCIPLE'
  | 'BUSINESS_POLICY'
  | 'CUSTOMER_POLICY'
  | 'EMPLOYEE_POLICY'
  | 'SAFETY_POLICY'
  | 'QUALITY_POLICY'
  | 'SALES_POLICY'
  | 'PROFIT_POLICY'
  | 'INVESTMENT_POLICY'
  | 'DX_AI_POLICY'
  | 'ORGANIZATION_PRINCIPLE'
  | 'AUTHORITY_PRINCIPLE'
  | 'MEETING_PRINCIPLE'
  | 'BEHAVIOR_STANDARD'
  | 'KPI_PRINCIPLE'
  | 'GOAL'
  | 'DATA_PRINCIPLE'
  | 'FORBIDDEN_PRACTICE';

export interface ConstitutionPrinciple {
  principleId: string;
  category: ConstitutionCategory;
  statement: string;
  scope: 'group' | 'lcc';
  source: string;
  sourceVersion: string;
  evidence: Evidence[];
  validFrom: string;
  validUntil?: string;
  status: ConstitutionStatus;
  approvedBy?: string;
  approvedAt?: string;
  relatedDecisions: string[];
  supersedes?: string;
  /** 提案チェック用のキーワード（この語を含む提案はこの原則と照合する） */
  conflictTriggers?: string[];
  /** 矛盾検知時にユーザーへ提示する説明 */
  conflictGuidance?: string;
  /** RECOMMENDED_CANDIDATE: 複数資料の突合で推奨できる候補（正式化はPRESIDENT承認） */
  recommended?: boolean;
  /** ACTIVE候補として優先レビュー対象 */
  priorityReview?: boolean;
}

/**
 * 第13期資料のREAD ONLY実測から抽出した原則候補（2026-08-08調査）。
 * 出典の正本判定: 「LCC 経営の聖書 第13期 v7 社長用」（Google Sheets、
 * 2026-06-04更新＝系列中最新）と「（LCC様）第13期 経営計画書（3校）.pdf」（印刷正本候補）。
 * すべてCANDIDATE — 社長承認でCURRENTへ格上げされる。
 */
const V7_SOURCE = 'LCC 経営の聖書 第13期 v7 社長用（Google Sheets 1qpfTv1U5…）';
const PDF_SOURCE = '（LCC様）第13期 経営計画書（3校）.pdf（Drive 1GzykTkpd…）';
const PDF_VERSION = '印刷3校（2026-04-01）本文読解済み';

function pdfEv(label: string, value: string): Evidence {
  return { label, value, source: PDF_SOURCE, asOf: DISCOVERED };
}
const V7_VERSION = 'v7（2026-06-04更新・系列中最新）';
const DISCOVERED = '2026-08-08';

function ev(label: string, value: string): Evidence {
  return { label, value, source: V7_SOURCE, asOf: DISCOVERED };
}

export const CONSTITUTION_CANDIDATES: ConstitutionPrinciple[] = [
  {
    principleId: 'const-001',
    priorityReview: true,
    category: 'DATA_PRINCIPLE',
    statement: '正本は1つ。元データは「LCC 全社業務OS 統合版」を正とし、他は参照専用とする',
    scope: 'group',
    source: V7_SOURCE,
    sourceVersion: V7_VERSION,
    evidence: [ev('原文', '日次の実務入力は行わない。元データは「LCC 全社業務OS 統合版」を正とする。')],
    validFrom: '2026-04-01',
    status: 'CANDIDATE',
    relatedDecisions: [],
    conflictTriggers: ['新しい台帳', '新しいシート', '別シート', '新規DB', '入力台帳', '転記', '新しいデータベース', '別管理'],
    conflictGuidance:
      '会社原則候補「正本は1つ・転記を増やさない」に反する可能性があります。既存正本への項目追加・連携を先に検討してください'
  },
  {
    principleId: 'const-002',
    priorityReview: true,
    category: 'DATA_PRINCIPLE',
    statement: '手入力箇所は最小化する（経営の聖書では月次実績入力が唯一の手入力シート。将来は原価日報から自動取得へ）',
    scope: 'group',
    source: V7_SOURCE,
    sourceVersion: V7_VERSION,
    evidence: [
      ev('原文', '月次実績入力（唯一の手入力シート）。それ以外は参照専用。'),
      ev('方向性', 'Google Sheets移行後はC2_原価日報から自動取得に切替予定')
    ],
    validFrom: '2026-04-01',
    status: 'CANDIDATE',
    relatedDecisions: [],
    conflictTriggers: ['手入力', '手作業で入力', '毎日入力'],
    conflictGuidance: '会社原則候補「手入力は最小化・自動取得へ」に照らし、自動連携の設計を優先してください'
  },
  {
    principleId: 'const-003',
    category: 'MANAGEMENT_PRINCIPLE',
    statement: '経営管理は武蔵野式3段管理・年計（年計=前月年計+当月実績-前年同月）で行う',
    scope: 'lcc',
    source: V7_SOURCE,
    sourceVersion: V7_VERSION,
    evidence: [ev('原文', '武蔵野式3段管理。年計=前月年計+当月実績-前年同月')],
    validFrom: '2026-04-01',
    status: 'CANDIDATE',
    relatedDecisions: []
  },
  {
    principleId: 'const-004',
    category: 'PROFIT_POLICY',
    statement:
      '粗利率信号基準（X2粗利管理ルール・全案件適用）: 青=70%以上 / 黄=50〜70% / 赤=20〜50% / 黒=20%未満。この定義書は変更不可',
    scope: 'lcc',
    source: V7_SOURCE,
    sourceVersion: V7_VERSION,
    evidence: [
      ev('原文', 'X2_粗利管理ルール 粗利率の判定基準（定義書）変更不可'),
      ev('基準', '青=70%以上 黄=50〜70% 赤=20〜50% 黒=20%未満')
    ],
    validFrom: '2026-04-01',
    status: 'CANDIDATE',
    relatedDecisions: [],
    conflictTriggers: ['粗利基準を変え', '信号基準', '判定基準を変更'],
    conflictGuidance: 'X2粗利管理ルールは「変更不可」と明記されています。変更は正式な方針変更手続きが必要です'
  },
  {
    principleId: 'const-005',
    priorityReview: true,
    category: 'MEETING_PRINCIPLE',
    statement:
      '現場別信号は毎日16時以降に確認し、赤・黒信号案件は当日中に社長へ報告する。スコアボードは各部長と代表が週次確認、月次実績は毎月5日までに前月分入力',
    scope: 'lcc',
    source: V7_SOURCE,
    sourceVersion: V7_VERSION,
    evidence: [
      ev('原文', '現場別信号 毎日16時以降に確認。赤・黒は当日中に社長へ報告。'),
      ev('原文', '毎月5日までに前月分を入力完了すること')
    ],
    validFrom: '2026-04-01',
    status: 'CANDIDATE',
    relatedDecisions: []
  },
  {
    principleId: 'const-006',
    priorityReview: true,
    category: 'BEHAVIOR_STANDARD',
    statement:
      '現場配置の運用基準: 配置は前日18時まで確定 / 責任者未設定は即対応 / 車両は前日確認 / 翌日赤信号案件は最優先',
    scope: 'lcc',
    source: V7_SOURCE,
    sourceVersion: V7_VERSION,
    evidence: [ev('原文', '配置未確定は前日18時まで確定・責任者未設定は即対応・翌日赤信号案件は最優先')],
    validFrom: '2026-04-01',
    status: 'CANDIDATE',
    relatedDecisions: []
  },
  {
    principleId: 'const-007',
    category: 'GOAL',
    statement:
      '第13期（2026年4月〜2027年3月）目標: 全社売上463.8百万円・粗利327.9百万円（解体課315.6/220.9、地域支援課133.2/94.0、不動産課15.0/2.3）。前期実績年計670.2百万円',
    scope: 'lcc',
    source: V7_SOURCE,
    sourceVersion: V7_VERSION,
    evidence: [
      ev('全社目標', '売上463.8百万円/年（38.6/月）・粗利327.9百万円/年（27.3/月）'),
      ev('注意', '経営管理_第13期_統合最終版（2026-04-01停止）には「均等割仮値」警告あり。不動産課はv7=15.0 vs 経営管理=15.6の差異'),
      {
        label: '突合結果',
        value: '不動産課15.0百万は印刷版経営計画書の長期事業構想表（第13期 不動産15.0）とも一致 → 15.0をRECOMMENDED_CANDIDATEとする',
        source: '（LCC様）第13期 経営計画書（3校）.pdf 長期事業構想表',
        asOf: DISCOVERED
      }
    ],
    validFrom: '2026-04-01',
    validUntil: '2027-03-31',
    status: 'CANDIDATE',
    recommended: true,
    relatedDecisions: []
  },
  {
    principleId: 'const-008',
    priorityReview: true,
    category: 'AUTHORITY_PRINCIPLE',
    statement: '粗利警戒案件・赤黒信号案件への介入は社長判断とする（配置アラート「粗利警戒件数→社長判断」）',
    scope: 'lcc',
    source: V7_SOURCE,
    sourceVersion: V7_VERSION,
    evidence: [ev('原文', '粗利警戒件数 → 社長判断 / 翌日赤信号案件数 → 最優先')],
    validFrom: '2026-04-01',
    status: 'CANDIDATE',
    relatedDecisions: []
  },
  {
    principleId: 'const-009',
    priorityReview: true,
    category: 'DX_AI_POLICY',
    statement:
      'AIによる外部自動送信・自動確定は行わない。金額・契約・納期・謝罪・責任認定・人事はAIが自動確定しない（LCC COMMAND運用原則）',
    scope: 'group',
    source: 'LCC COMMAND Phase 1〜X 承認済み設計（CLAUDE.md 変更禁止方針）',
    sourceVersion: 'Phase 1（2026-08確立）',
    evidence: [
      {
        label: '出典',
        value: 'AIによる外部自動返信は作らない。金額・契約・納期・謝罪・責任認定は自動確定しない',
        source: 'リポジトリ CLAUDE.md（重要な制約）',
        asOf: DISCOVERED
      }
    ],
    validFrom: '2026-08-01',
    status: 'CANDIDATE',
    relatedDecisions: [],
    conflictTriggers: ['自動送信', '自動で送', '自動返信', '自動確定', '勝手に送'],
    conflictGuidance: '会社原則候補「AIの外部自動送信・自動確定は行わない」に反します。承認フロー（dry-run）を通してください'
  }
,
  // ---- 印刷版「（LCC様）第13期 経営計画書（3校）.pdf」本文からの抽出（2026-08-08読解） ----
  {
    principleId: 'const-010',
    category: 'MISSION',
    statement: 'ミッション: 地域の「困った」を「ありがとう」に変える',
    scope: 'group',
    source: PDF_SOURCE,
    sourceVersion: PDF_VERSION,
    evidence: [pdfEv('原文', '地域の「困った」を「ありがとう」に変える。私たちのすべての事業は、この使命から始まっています')],
    validFrom: '2026-04-01',
    status: 'CANDIDATE',
    priorityReview: true,
    relatedDecisions: []
  },
  {
    principleId: 'const-011',
    category: 'VISION',
    statement: 'ビジョン: 暮らしのすべてを支える、山陰の生活インフラになる（「何かあったら、まずLCCに相談しよう」と真っ先に思い浮かべられる存在）',
    scope: 'group',
    source: PDF_SOURCE,
    sourceVersion: PDF_VERSION,
    evidence: [pdfEv('原文', '暮らしのすべてを支える、山陰の生活インフラになる')],
    validFrom: '2026-04-01',
    status: 'CANDIDATE',
    priorityReview: true,
    relatedDecisions: []
  },
  {
    principleId: 'const-012',
    category: 'VALUES',
    statement: 'バリュー: ①我がごと化するプロであれ ②まず、やってみる ③チームで、大きな価値を',
    scope: 'group',
    source: PDF_SOURCE,
    sourceVersion: PDF_VERSION,
    evidence: [pdfEv('原文', '（１）我がごと化するプロであれ（２）まず、やってみる（３）チームで、大きな価値を')],
    validFrom: '2026-04-01',
    status: 'CANDIDATE',
    priorityReview: true,
    relatedDecisions: []
  },
  {
    principleId: 'const-013',
    category: 'MANAGEMENT_PRINCIPLE',
    statement: '経営理念: 各事業を通しお客様の満足と社員の幸福を同時に実現し、社業を通じて地域社会への貢献を実行する（社訓: 礼節・信用・責任）',
    scope: 'group',
    source: PDF_SOURCE,
    sourceVersion: PDF_VERSION,
    evidence: [pdfEv('原文', '経営理念・社訓（礼節/信用/責任）・行動指針3項')],
    validFrom: '2026-04-01',
    status: 'CANDIDATE',
    priorityReview: true,
    relatedDecisions: []
  },
  {
    principleId: 'const-014',
    category: 'SAFETY_POLICY',
    statement: '安全第一。工期が遅れても安全を犠牲にしない。飲酒運転絶対禁止・アルコールチェック実施・事故時は人命救助→警察→上司事務所→保険会社の順',
    scope: 'group',
    source: PDF_SOURCE,
    sourceVersion: PDF_VERSION,
    evidence: [pdfEv('原文', '施工に関する方針「安全第一。工期が遅れても、安全を犠牲にしてはならない」/ 運転に関する方針')],
    validFrom: '2026-04-01',
    status: 'CANDIDATE',
    relatedDecisions: []
  },
  {
    principleId: 'const-015',
    category: 'QUALITY_POLICY',
    statement: '「完了」とは作業が終わったことではない。清掃を終え、お客様に引き渡して初めて完了とする。現場は毎日ショールーム',
    scope: 'lcc',
    source: PDF_SOURCE,
    sourceVersion: PDF_VERSION,
    evidence: [pdfEv('原文', '施工に関する方針 2.品質・納期')],
    validFrom: '2026-04-01',
    status: 'CANDIDATE',
    relatedDecisions: []
  },
  {
    principleId: 'const-016',
    category: 'CUSTOMER_POLICY',
    statement: 'クレーム・事故の第一報は即時（30分以内）。発生責任はすべて社長にあり、報告者を責めず仕組みを改善する。隠した時のみ評価を下げる',
    scope: 'group',
    source: PDF_SOURCE,
    sourceVersion: PDF_VERSION,
    evidence: [pdfEv('原文', 'クレーム及び事故に関する方針')],
    validFrom: '2026-04-01',
    status: 'CANDIDATE',
    relatedDecisions: []
  },
  {
    principleId: 'const-017',
    category: 'SALES_POLICY',
    statement: '見積提出後の値引きはしない（クロージング時値引きは5%以下）。規定の利益率を計算した上で提出し、予備費5%・価格の3割の利益を確保。60分商圏外は粗利率50%以上のみ受注',
    scope: 'lcc',
    source: PDF_SOURCE,
    sourceVersion: PDF_VERSION,
    evidence: [pdfEv('原文', '営業に関する方針 3.価格 / 長期事業構想書（60分商圏）')],
    validFrom: '2026-04-01',
    status: 'CANDIDATE',
    relatedDecisions: [],
    conflictTriggers: ['値引き', '大幅割引', '安売り'],
    conflictGuidance: '営業方針候補「見積提出後の値引きはしない・値引き5%以下」に照らして確認してください'
  },
  {
    principleId: 'const-018',
    category: 'INVESTMENT_POLICY',
    statement: '財務原則: 現預金残高は常に月商の3ヶ月分以上を維持。支払手形は発行しない。粉飾決算は絶対にしない。悪い情報ほど早く銀行に報告する',
    scope: 'group',
    source: PDF_SOURCE,
    sourceVersion: PDF_VERSION,
    evidence: [pdfEv('原文', '資金計画 / 内部体制に関する方針 2.資金・決算')],
    validFrom: '2026-04-01',
    status: 'CANDIDATE',
    priorityReview: true,
    relatedDecisions: []
  },
  {
    principleId: 'const-019',
    category: 'DX_AI_POLICY',
    statement: 'DX原則: AIを強制活用し転記・属人化を排除。口頭・紙の報告は受け取らない（デジタル報告のみ）。「社内指定システム」を情報の中心基地とし、入力なき仕事は評価しない。人を増やさずに回すために投資する',
    scope: 'group',
    source: PDF_SOURCE,
    sourceVersion: PDF_VERSION,
    evidence: [pdfEv('原文', '長期事業構想書 5.装置・設備計画（IT・DXの徹底）/ 内部体制に関する方針')],
    validFrom: '2026-04-01',
    status: 'CANDIDATE',
    priorityReview: true,
    relatedDecisions: []
  },
  {
    principleId: 'const-020',
    category: 'GOAL',
    statement: '長期目標: 5年後（第17期）売上8.1億円・粗利5.8億円・経常利益0.75億円。解体は元請比率70%以上・高粗利体質。不動産在庫は6ヶ月以内に現金化。企業支援事業は第14期以降完全撤退',
    scope: 'group',
    source: PDF_SOURCE,
    sourceVersion: PDF_VERSION,
    evidence: [pdfEv('原文', '長期事業構想書 3.利益計画（必達）/ 長期事業構想表')],
    validFrom: '2026-04-01',
    status: 'CANDIDATE',
    relatedDecisions: []
  }
];

let principleSeq = 100;
export function resetPrincipleSeq(): void {
  principleSeq = 100;
}

export class ConstitutionService {
  constructor(private readonly repository: CommandRepository) {}

  /** 保存済み + 未保存の抽出候補（初回はシードを保存する） */
  async list(): Promise<ConstitutionPrinciple[]> {
    const stored = await this.repository.getPrinciples();
    if (stored.length === 0) {
      for (const candidate of CONSTITUTION_CANDIDATES) {
        await this.repository.savePrinciple({ ...candidate });
      }
      return this.repository.getPrinciples();
    }
    return stored;
  }

  async current(): Promise<ConstitutionPrinciple[]> {
    return (await this.list()).filter((p) => p.status === 'CURRENT');
  }

  /** ユーザー承認でCANDIDATE→CURRENT（§5・§8）。PRESIDENTのみ */
  async approve(principleId: string, principal: Principal, now: string): Promise<ConstitutionPrinciple> {
    if (principal.role !== 'PRESIDENT') {
      throw new AccessDeniedError(`ロール${principal.role}は会社原則を確定できません`);
    }
    const all = await this.list();
    const target = all.find((p) => p.principleId === principleId);
    if (!target) throw new Error(`Principle ${principleId} が見つかりません`);
    const approved: ConstitutionPrinciple = {
      ...target,
      status: 'CURRENT',
      approvedBy: principal.label,
      approvedAt: now
    };
    await this.repository.savePrinciple(approved);
    return approved;
  }

  /** 方針変更（§8）: 旧をSUPERSEDED、新をCANDIDATEで登録（履歴を消さない） */
  async supersede(
    principleId: string,
    newStatement: string,
    principal: Principal,
    now: string
  ): Promise<ConstitutionPrinciple> {
    if (principal.role !== 'PRESIDENT') {
      throw new AccessDeniedError(`ロール${principal.role}は会社原則を変更できません`);
    }
    const all = await this.list();
    const old = all.find((p) => p.principleId === principleId);
    if (!old) throw new Error(`Principle ${principleId} が見つかりません`);
    await this.repository.savePrinciple({ ...old, status: 'SUPERSEDED' });
    principleSeq += 1;
    const replacement: ConstitutionPrinciple = {
      ...old,
      principleId: `const-${principleSeq}`,
      statement: newStatement,
      status: 'CANDIDATE',
      source: `会話での方針変更（${principal.label}）`,
      sourceVersion: now.slice(0, 10),
      supersedes: old.principleId,
      approvedBy: undefined,
      approvedAt: undefined,
      evidence: [
        { label: '変更指示', value: newStatement.slice(0, 120), source: `会話（${principal.label}）`, asOf: now }
      ]
    };
    await this.repository.savePrinciple(replacement);
    return replacement;
  }

  /**
   * 提案テキストを原則と照合し、反する可能性を警告する（§7・§46）。
   * CURRENTは「会社原則」、CANDIDATEは「会社原則候補」として提示する。
   */
  async checkProposal(proposalText: string): Promise<
    Array<{ principle: ConstitutionPrinciple; warning: string }>
  > {
    const active = (await this.list()).filter(
      (p) => p.status === 'CURRENT' || p.status === 'CANDIDATE'
    );
    const hits: Array<{ principle: ConstitutionPrinciple; warning: string }> = [];
    for (const principle of active) {
      if (!principle.conflictTriggers) continue;
      if (principle.conflictTriggers.some((t) => proposalText.includes(t))) {
        const label = principle.status === 'CURRENT' ? '会社原則' : '会社原則候補';
        hits.push({
          principle,
          warning: `技術的には可能ですが、現在の${label}「${principle.statement.split('。')[0]}」に反する可能性があります。${principle.conflictGuidance ?? ''}`
        });
      }
    }
    return hits;
  }
}
