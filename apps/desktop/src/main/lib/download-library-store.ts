import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { DownloadLibraryEntry } from '../../shared/download-library'
import { scopedLoggers } from '../utils/logger'

let saved: DownloadLibraryEntry[] | undefined
function historyFile() {
  return path.join(app.getPath('userData'), 'image-download-history.json')
}
export function savedImageDownloads(): DownloadLibraryEntry[] {
  if (!saved) {
    saved = []
    try {
      if (existsSync(historyFile())) {
        const data = JSON.parse(readFileSync(historyFile(), 'utf8'))
        if (data.version === 1 && Array.isArray(data.items)) {
          saved = data.items
        }
      }
    } catch (error) {
      scopedLoggers.download.warn('Could not restore image download history', error)
    }
  }
  return saved || []
}
export function recordSavedImage(sourceUrl: string, filePath: string, title: string) {
  const rows = savedImageDownloads()
  if (rows.some((row) => row.filePath === filePath)) {
    return
  }
  rows.push({
    id: randomUUID(),
    sourceUrl,
    filePath,
    title,
    kind: 'image',
    status: 'completed',
    progress: 100,
    createdAt: Date.now(),
    thumbnail: sourceUrl
  })
  try {
    mkdirSync(path.dirname(historyFile()), { recursive: true })
    writeFileSync(`${historyFile()}.next`, JSON.stringify({ version: 1, items: rows }))
    renameSync(`${historyFile()}.next`, historyFile())
  } catch (error) {
    scopedLoggers.download.warn('Could not save image download history', error)
  }
}
