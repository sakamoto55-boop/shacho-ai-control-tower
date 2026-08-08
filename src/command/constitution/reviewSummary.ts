/**
 * Constitution最終確定支援（LIVE BETA §6-§7）。
 *
 * CONSTITUTION_REVIEW.md の10項目を、社長が5〜10分で確認できる構造化サマリーにする。
 * - 原文はConstitution Registryのstatement（AIの作文なし）
 * - 一括承認可能。ただしConflict由来の項目（const-007: 不動産課15.0 vs 15.6）は個別確認
 * - 正式化はPRESIDENTの「この内容で確定」明示のみ。履歴（approvedBy/approvedAt）を残す
 */
import type { Principal } from '../domain/types.js';
import { ConstitutionService, type ConstitutionPrinciple } from './constitutionRegistry.js';

export interface ReviewItemDefinition {
  itemNo: number;
  title: string;
  principleIds: string[];
  /** 意味（この項目を承認すると何が正式化されるか） */
  meaning: string;
  /** 経営への影響（承認後のシステム挙動） */
  impact: string;
  /** Conflict由来（一括承認から除外し個別確認） */
  requiresIndividualConfirm?: boolean;
}

/** CONSTITUTION_REVIEW.md の10項目（正本はレビュー文書。ここはその構造化） */
export const REVIEW_ITEMS: ReviewItemDefinition[] = [
  {
    itemNo: 1,
    title: '理念・MVV一式',
    principleIds: ['const-010', 'const-011', 'const-012', 'const-013'],
    meaning: 'ミッション・ビジョン・バリュー・経営理念・社訓を印刷版PDF原文どおり正式化',
    impact: 'AIの提案・文章生成が理念と照合されるようになります（Constitution Guard）'
  },
  {
    itemNo: 2,
    title: '正本は1つ・手入力最小化',
    principleIds: ['const-001', 'const-002'],
    meaning: 'データ運用原則（新しい台帳・二重管理を作らない）を正式化',
    impact: '「新しいシートを作る」系の改善提案に自動で警告が付きます'
  },
  {
    itemNo: 3,
    title: '赤黒当日社長報告・月次5日締め・配置前日18時確定',
    principleIds: ['const-005', 'const-006'],
    meaning: '運用リズム（報告・締め・配置確定の期限）を正式化',
    impact: '期限超過をアラート・Growth観測の判定基準に使えるようになります'
  },
  {
    itemNo: 4,
    title: '社長介入権限',
    principleIds: ['const-008'],
    meaning: '粗利警戒・赤黒案件への介入は社長判断であることを正式化',
    impact: '該当案件の検知時に「社長判断が必要」と明示されます'
  },
  {
    itemNo: 5,
    title: 'AI自動送信・自動確定禁止',
    principleIds: ['const-009'],
    meaning: 'LCC COMMANDの運用原則（外部送信・金額確定は承認必須）を憲法として正式化',
    impact: 'コードで強制済みの挙動が、会社の正式原則として文書化されます'
  },
  {
    itemNo: 6,
    title: '安全・品質方針',
    principleIds: ['const-014', 'const-015'],
    meaning: '安全第一・「清掃して引き渡して完了」を正式化',
    impact: '現場系の提案・文章がこの方針と照合されます'
  },
  {
    itemNo: 7,
    title: 'クレーム30分初動・社長責任原則',
    principleIds: ['const-016'],
    meaning: 'クレーム対応の初動期限と責任所在を正式化',
    impact: 'クレーム系アラートの優先度・文章生成の前提になります'
  },
  {
    itemNo: 8,
    title: '営業価格原則',
    principleIds: ['const-017'],
    meaning: '値引き5%以下・利益率計算後提出・60分商圏を正式化',
    impact: '「値引き」を含む提案・見積に自動で警告が付きます'
  },
  {
    itemNo: 9,
    title: '財務原則',
    principleIds: ['const-018'],
    meaning: '現預金は月商3ヶ月分以上・手形なし・悪い情報ほど早く銀行へ、を正式化',
    impact: '資金繰り評価の判定基準として使えるようになります（銀行接続後）'
  },
  {
    itemNo: 10,
    title: '第13期目標値 + 長期目標',
    principleIds: ['const-007', 'const-020'],
    meaning: '第13期目標（不動産課はRECOMMENDED: 15.0）と5年後長期目標を正式化',
    impact: '目標比の着地評価・Target Registryの正本になります',
    requiresIndividualConfirm: true // Conflict（15.0 vs 15.6）解消済みだが§6により個別確認
  }
];

export interface ReviewSummaryItem extends ReviewItemDefinition {
  /** 原文（Registryのstatement。AIの作文なし） */
  originals: Array<{ principleId: string; statement: string; source: string; status: string }>;
  currentStatus: 'ALL_CURRENT' | 'PARTIALLY_CURRENT' | 'CANDIDATE';
  aiRecommendation: string;
}

export async function buildReviewSummary(
  service: ConstitutionService
): Promise<{ items: ReviewSummaryItem[]; bulkApprovable: number[]; individualConfirm: number[] }> {
  const principles = await service.list();
  const byId = new Map(principles.map((p) => [p.principleId, p]));
  const items: ReviewSummaryItem[] = REVIEW_ITEMS.map((item) => {
    const originals = item.principleIds
      .map((id) => byId.get(id))
      .filter((p): p is ConstitutionPrinciple => p !== undefined)
      .map((p) => ({
        principleId: p.principleId,
        statement: p.statement,
        source: `${p.source}（${p.sourceVersion}）`,
        status: p.status
      }));
    const currentCount = originals.filter((o) => o.status === 'CURRENT').length;
    return {
      ...item,
      originals,
      currentStatus:
        currentCount === originals.length && originals.length > 0
          ? 'ALL_CURRENT'
          : currentCount > 0
            ? 'PARTIALLY_CURRENT'
            : 'CANDIDATE',
      aiRecommendation: item.requiresIndividualConfirm
        ? '承認推奨（ただしConflict解消項目のため個別確認: 不動産課15.0はv7+印刷版PDFの2源一致）'
        : '承認推奨（複数資料からの原文抽出。AIの作文なし）'
    };
  });
  return {
    items,
    bulkApprovable: items.filter((i) => !i.requiresIndividualConfirm).map((i) => i.itemNo),
    individualConfirm: items.filter((i) => i.requiresIndividualConfirm).map((i) => i.itemNo)
  };
}

export interface BulkApprovalResult {
  approvedPrincipleIds: string[];
  skippedForIndividualConfirm: string[];
  alreadyCurrent: string[];
}

/**
 * 一括承認（§6-§7）。PRESIDENTの「この内容で確定」明示が前提（呼び出し側で確認）。
 * Conflict由来の項目は承認せずskippedへ返す（個別確認を促す）。
 */
export async function bulkApprove(
  service: ConstitutionService,
  principal: Principal,
  now: string,
  options: { includeIndividualConfirm?: boolean } = {}
): Promise<BulkApprovalResult> {
  const principles = await service.list();
  const byId = new Map(principles.map((p) => [p.principleId, p]));
  const approved: string[] = [];
  const skipped: string[] = [];
  const alreadyCurrent: string[] = [];
  for (const item of REVIEW_ITEMS) {
    for (const principleId of item.principleIds) {
      const principle = byId.get(principleId);
      if (!principle) continue;
      if (principle.status === 'CURRENT') {
        alreadyCurrent.push(principleId);
        continue;
      }
      if (item.requiresIndividualConfirm && !options.includeIndividualConfirm) {
        skipped.push(principleId);
        continue;
      }
      await service.approve(principleId, principal, now); // PRESIDENT検査はservice側で強制
      approved.push(principleId);
    }
  }
  return { approvedPrincipleIds: approved, skippedForIndividualConfirm: skipped, alreadyCurrent };
}
