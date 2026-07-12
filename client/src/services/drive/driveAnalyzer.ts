import type { GoogleDriveFile, DriveFileCategory, DriveFileImportance, DriveSummary } from './types'

export function analyzeCategory(file: GoogleDriveFile): DriveFileCategory {
  const name = file.name

  if (/銀行|信金|信用|融資|借入|ローン|金融/.test(name)) return '銀行'
  if (/契約|契約書|覚書|協定|請負/.test(name)) return '契約'
  if (/請求|請求書|未請求|インボイス/.test(name)) return '請求'
  if (/見積|見積書|積算|提案書/.test(name)) return '見積'
  if (/現場|施設|工事|竣工|仕様/.test(name)) return '現場'
  if (/事故|報告書|インシデント|トラブル/.test(name)) return '事故'
  if (/介護|福祉|ケア|訪問|デイ/.test(name)) return '福祉'
  if (/監査|TKC|freee|税務|会計|決算/.test(name)) return '監査'
  if (/資金|キャッシュフロー|CF/.test(name)) return '資金繰り'
  if (/車両|車|バス|トラック|ドライブ/.test(name)) return '車両'
  return 'その他'
}

export function analyzeImportance(file: GoogleDriveFile, category: DriveFileCategory): DriveFileImportance {
  if (
    file.starred === true ||
    (['銀行', '事故', '監査', '資金繰り'] as DriveFileCategory[]).includes(category) ||
    /至急|緊急|最終|期限|締切/.test(file.name)
  ) {
    return 'A'
  }
  if ((['契約', '請求', '行政', '現場', '車両'] as DriveFileCategory[]).includes(category)) {
    return 'B'
  }
  return 'C'
}

export function hasRiskFlag(file: GoogleDriveFile, category: DriveFileCategory): boolean {
  return (
    (['事故', '銀行', '監査', '資金繰り'] as DriveFileCategory[]).includes(category) ||
    /未払|未回収|未請求|督促|警告|事故/.test(file.name)
  )
}

export function suggestAction(category: DriveFileCategory): string | null {
  switch (category) {
    case '銀行':
      return '銀行打合せ前に内容を確認してください'
    case '契約':
      return '契約期限と締結状況を確認してください'
    case '請求':
      return '未請求・未回収の確認をしてください'
    case '見積':
      return '承認状況を確認してください'
    case '事故':
      return '事故対応状況と保険連絡を確認してください'
    case '監査':
      return '監査対応書類の最終確認をしてください'
    case '資金繰り':
      return '最新の資金繰り状況を確認してください'
    case '車両':
      return '車両状態と保険の確認をしてください'
    default:
      return null
  }
}

export function extractRelatedCompany(file: GoogleDriveFile): string | null {
  const name = file.name
  if (/東京信金|信金/.test(name)) return '東京信用金庫'
  if (/TKC/.test(name)) return 'TKC'
  if (/freee/.test(name)) return 'freee'
  return null
}

export function resolveFileType(mimeType: string): string {
  switch (mimeType) {
    case 'application/pdf':
      return 'PDF'
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return 'Excel'
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return 'Word'
    case 'application/vnd.google-apps.spreadsheet':
      return 'スプレッドシート'
    case 'application/vnd.google-apps.document':
      return 'ドキュメント'
    case 'application/vnd.google-apps.presentation':
      return 'スライド'
    default:
      return 'ファイル'
  }
}

export function resolveFolderName(parents: string[]): string | null {
  const parent = parents[0]
  if (!parent) return null
  switch (parent) {
    case 'folder-bank':
      return '銀行・財務'
    case 'folder-contract':
      return '契約書'
    case 'folder-invoice':
      return '請求・未請求'
    case 'folder-audit':
      return '監査対応'
    case 'folder-accident':
      return '事故報告'
    case 'folder-finance':
      return '資金繰り'
    case 'folder-estimate':
      return '見積書'
    default:
      return null
  }
}

export function createDriveSummary(files: GoogleDriveFile[]): DriveSummary {
  let importanceACount = 0
  let riskFlagCount = 0
  let bankCount = 0
  let contractCount = 0
  let invoiceCount = 0
  let accidentCount = 0
  let auditCount = 0
  let lastModifiedAt: string | null = null

  for (const file of files) {
    const category = analyzeCategory(file)
    const importance = analyzeImportance(file, category)
    const risk = hasRiskFlag(file, category)

    if (importance === 'A') importanceACount++
    if (risk) riskFlagCount++
    if (category === '銀行') bankCount++
    if (category === '契約') contractCount++
    if (category === '請求') invoiceCount++
    if (category === '事故') accidentCount++
    if (category === '監査') auditCount++

    if (!lastModifiedAt || file.modifiedTime > lastModifiedAt) {
      lastModifiedAt = file.modifiedTime
    }
  }

  return {
    totalCount: files.length,
    importanceACount,
    riskFlagCount,
    bankCount,
    contractCount,
    invoiceCount,
    accidentCount,
    auditCount,
    lastModifiedAt,
  }
}
