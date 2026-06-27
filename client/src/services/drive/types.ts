// Google Drive ReadOnly 型定義
// 書き込みAPI（createFile / updateFile / deleteFile / moveFile / shareFile / changePermission / uploadFile / copyFile）は未実装

export interface GoogleDriveFile {
  id: string
  name: string
  mimeType: string
  webViewLink: string | null
  createdTime: string   // ISO 8601
  modifiedTime: string  // ISO 8601
  owners: { displayName: string; emailAddress: string }[]
  parents: string[]
  size: string | null
  starred: boolean
  trashed: boolean
  shared: boolean
}

export type DriveFileCategory =
  | '銀行'
  | '契約'
  | '請求'
  | '見積'
  | '現場'
  | '事故'
  | '福祉'
  | '監査'
  | '資金繰り'
  | '車両'
  | 'その他'

export type DriveFileImportance = 'A' | 'B' | 'C'

export interface DriveDerivedFile {
  id: string
  sourceFileId: string
  name: string
  mimeType: string
  fileType: string
  webViewLink: string | null
  createdAt: string
  modifiedAt: string
  ownerName: string | null
  folderName: string | null
  category: DriveFileCategory
  relatedCompany: string | null
  relatedPerson: string | null
  relatedProject: string | null
  importance: DriveFileImportance
  riskFlag: boolean
  suggestedAction: string | null
}

export interface DriveSummary {
  totalCount: number
  importanceACount: number
  riskFlagCount: number
  bankCount: number
  contractCount: number
  invoiceCount: number
  accidentCount: number
  auditCount: number
  lastModifiedAt: string | null
}
