// Google Drive ファイル → DriveDerivedFile / UnifiedFileItem 変換
// 書き込みフィールドは生成しない

import type { GoogleDriveFile, DriveDerivedFile } from './types'
import type { UnifiedFileItem } from '../../core/providers/providerTypes'
import {
  analyzeCategory,
  analyzeImportance,
  hasRiskFlag,
  suggestAction,
  extractRelatedCompany,
  resolveFileType,
  resolveFolderName,
} from './driveAnalyzer'

export function mapToDriveDerivedFile(file: GoogleDriveFile, folderName: string | null): DriveDerivedFile {
  const category = analyzeCategory(file)
  const importance = analyzeImportance(file, category)
  const riskFlag = hasRiskFlag(file, category)

  return {
    id: `drive-derived-${file.id}`,
    sourceFileId: file.id,
    name: file.name,
    mimeType: file.mimeType,
    fileType: resolveFileType(file.mimeType),
    webViewLink: file.webViewLink,
    createdAt: file.createdTime,
    modifiedAt: file.modifiedTime,
    ownerName: file.owners[0]?.displayName ?? null,
    folderName,
    category,
    relatedCompany: extractRelatedCompany(file),
    relatedPerson: null,
    relatedProject: null,
    importance,
    riskFlag,
    suggestedAction: suggestAction(category),
  }
}

export function mapDriveDerivedFileToUnifiedFileItem(f: DriveDerivedFile, sourceLabel: string): UnifiedFileItem {
  return {
    id: `drive-${f.sourceFileId}`,
    source: sourceLabel,
    providerType: 'file',
    name: f.name,
    mimeType: f.mimeType,
    fileType: f.fileType,
    webViewLink: f.webViewLink,
    createdAt: f.createdAt,
    modifiedAt: f.modifiedAt,
    ownerName: f.ownerName,
    owner: f.ownerName,
    folderName: f.folderName,
    category: f.category,
    relatedCompany: f.relatedCompany,
    relatedPerson: f.relatedPerson,
    relatedProject: f.relatedProject,
    importance: f.importance,
    alertLevel: f.riskFlag ? 'danger' : f.importance === 'A' ? 'warning' : null,
    riskFlag: f.riskFlag,
    suggestedAction: f.suggestedAction,
    readOnly: true as const,
    writeEnabled: false as const,
  }
}

export function mapGoogleDriveFileToUnifiedFileItem(file: GoogleDriveFile, sourceLabel: string): UnifiedFileItem {
  const folderName = resolveFolderName(file.parents)
  const derived = mapToDriveDerivedFile(file, folderName)
  return mapDriveDerivedFileToUnifiedFileItem(derived, sourceLabel)
}
