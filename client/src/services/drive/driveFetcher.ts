// fetchDriveFiles(accessToken): Promise<GoogleDriveFile[]>
// GET /drive/v3/files のみ
//
// 未実装（書き込み禁止）:
//   createFile    — 未実装
//   updateFile    — 未実装
//   deleteFile    — 未実装
//   moveFile      — 未実装
//   shareFile     — 未実装
//   changePermission — 未実装
//   uploadFile    — 未実装
//   copyFile      — 未実装

import type { GoogleDriveFile } from './types'

const DRIVE_FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files'

export async function fetchDriveFiles(accessToken: string): Promise<GoogleDriveFile[]> {
  const params = new URLSearchParams({
    pageSize: '50',
    orderBy: 'modifiedTime desc',
    fields: 'files(id,name,mimeType,webViewLink,createdTime,modifiedTime,owners,parents,size,starred,trashed,shared)',
  })

  const response = await fetch(`${DRIVE_FILES_ENDPOINT}?${params.toString()}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Google Drive API error: ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as { files?: GoogleDriveFile[] }
  return (data.files ?? []).filter((f) => !f.trashed)
}
