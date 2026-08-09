/**
 * Data Stewardship Layer（Phase X §9）。
 *
 * 重要SourceごとのOwner・更新頻度・品質責任を管理する。
 * AIが異常を発見した場合「誰が確認すべき情報か」まで提示するための正本。
 * 担当は経営の聖書v7社長用の運用記載（READ ONLY実測）に基づく。
 */

export interface DataSteward {
  sourceKey: string;
  label: string;
  sourceOwner: string;
  departmentOwner: string;
  updateFrequency: string;
  expectedFreshness: string;
  qualityResponsibility: string;
  evidence: string;
}

export const DATA_STEWARDSHIP: DataSteward[] = [
  {
    sourceKey: 'projects',
    label: '案件（統合業務システム）',
    sourceOwner: '営業担当（案件登録者）',
    departmentOwner: '営業部',
    updateFrequency: '随時（受注・見積時）',
    expectedFreshness: '当日',
    qualityResponsibility: '金額・ステージの入力漏れは営業部が是正',
    evidence: '統合業務システムDB projects.staff列に営業担当が記録されている'
  },
  {
    sourceKey: 'customers',
    label: '顧客（統合業務システム）',
    sourceOwner: '営業担当',
    departmentOwner: '営業部',
    updateFrequency: '随時',
    expectedFreshness: '当日',
    qualityResponsibility: '重複顧客・表記ゆれの統合判断',
    evidence: '統合業務システムDB customers（2,268件）'
  },
  {
    sourceKey: 'daily_reports',
    label: '実績日報',
    sourceOwner: '各現場→AI読み取り→確認者',
    departmentOwner: '工務部（解体課・地域支援課）',
    updateFrequency: '毎日',
    expectedFreshness: '翌営業日',
    qualityResponsibility: '「日報データ（AI読み取り）」の確認ステータス確定',
    evidence: '日報データ（AI読み取り）シートの確認ステータス・確定✔列'
  },
  {
    sourceKey: 'monthly_actuals',
    label: '月次実績（経営の聖書）',
    sourceOwner: '業務サポート課',
    departmentOwner: '業務サポート課',
    updateFrequency: '毎月末（毎月5日までに前月分）',
    expectedFreshness: '月次',
    qualityResponsibility: '月次実績入力（唯一の手入力シート）の正確性',
    evidence: '経営の聖書v7「月次実績入力【加藤さん専用】毎月5日までに前月分を入力完了」'
  },
  {
    sourceKey: 'site_signals',
    label: '現場別信号（赤黒）',
    sourceOwner: '業務サポート課→代表取締役',
    departmentOwner: '業務サポート課',
    updateFrequency: '毎日16時',
    expectedFreshness: '当日',
    qualityResponsibility: '赤・黒信号の当日中の社長報告',
    evidence: '経営の聖書v7「毎日16時以降に確認。赤・黒は当日中に社長へ報告」'
  },
  {
    sourceKey: 'payroll',
    label: '給与（People OS）',
    sourceOwner: '代表取締役',
    departmentOwner: '経理・管理',
    updateFrequency: '版管理（v17現在）',
    expectedFreshness: '改定時',
    qualityResponsibility: '正本宣言の維持・高機密管理（複製禁止）',
    evidence: 'People OS v17正本宣言（2026-07-26）'
  },
  {
    sourceKey: 'targets',
    label: '経営目標',
    sourceOwner: '代表取締役',
    departmentOwner: '経営',
    updateFrequency: '期次',
    expectedFreshness: '期首確定',
    qualityResponsibility: 'Target Registry承認（AIは独断でACTIVEにしない）',
    evidence: '経営の聖書v7 第13期目標値（CANDIDATE登録対象）'
  },
  {
    sourceKey: 'bank',
    label: '銀行残高・入出金',
    sourceOwner: '未確定（ソース未特定）',
    departmentOwner: '経理',
    updateFrequency: '不明',
    expectedFreshness: '前営業日',
    qualityResponsibility: '未確定（DG-004）',
    evidence: 'Data Gap DG-004（銀行ソース未特定）'
  }
];

export function findSteward(sourceKey: string): DataSteward | undefined {
  return DATA_STEWARDSHIP.find((s) => s.sourceKey === sourceKey);
}
