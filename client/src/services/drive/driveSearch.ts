import type { UnifiedFileItem } from '../../core/providers/providerTypes'

export interface DriveSearchResult {
  item: UnifiedFileItem
  matchedField: 'name' | 'category' | 'relatedCompany' | 'relatedPerson' | 'relatedProject' | 'folderName'
  relevanceScore: number
}

export function searchDriveFiles(query: string, files: UnifiedFileItem[]): DriveSearchResult[] {
  if (!query.trim()) return []
  const q = query.toLowerCase()
  const results: DriveSearchResult[] = []

  for (const file of files) {
    let score = 0
    let matchedField: DriveSearchResult['matchedField'] = 'name'

    if (file.name.toLowerCase().includes(q)) { score = 100; matchedField = 'name' }
    else if (file.category.toLowerCase().includes(q)) { score = 80; matchedField = 'category' }
    else if (file.relatedCompany?.toLowerCase().includes(q)) { score = 70; matchedField = 'relatedCompany' }
    else if (file.relatedPerson?.toLowerCase().includes(q)) { score = 60; matchedField = 'relatedPerson' }
    else if (file.relatedProject?.toLowerCase().includes(q)) { score = 50; matchedField = 'relatedProject' }
    else if (file.folderName?.toLowerCase().includes(q)) { score = 40; matchedField = 'folderName' }

    if (score > 0) {
      if (file.importance === 'A') score += 10
      if (file.riskFlag) score += 5
      results.push({ item: file, matchedField, relevanceScore: score })
    }
  }

  return results.sort((a, b) => b.relevanceScore - a.relevanceScore)
}
