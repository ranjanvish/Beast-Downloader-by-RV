import { isMediaTaskKind } from '@vidbee/task-queue'
import { type DownloadLibraryEntry, filterDownloadLibrary } from '../../shared/download-library'
import { emptyMixedOptions, type MixedEntry } from '../../shared/mixed-download'
import { recordSavedImage, savedImageDownloads } from './download-library-store'
import { getMixedBatch } from './mixed-batch-host'
import { projectTaskForRenderer } from './projection'
import { getDesktopTaskQueue, startDesktopTaskQueue } from './task-queue-host'

export async function downloadLibrary(page = 0, kind = 'all', query = '') {
  await startDesktopTaskQueue()
  const workspace = getMixedBatch().items
  for (const row of workspace) {
    if (row.kind === 'image' && row.status === 'completed' && row.filePath) {
      recordSavedImage(row.options.imageUrl || row.sourceUrl, row.filePath, row.title)
    }
  }
  const rows: DownloadLibraryEntry[] = [...savedImageDownloads()]
  const taskIds = new Set<string>()
  let cursor: string | null = null
  do {
    const result = getDesktopTaskQueue().list({ limit: 200, cursor })
    for (const task of result.tasks) {
      if (!isMediaTaskKind(task.kind)) {
        continue
      }
      const item = projectTaskForRenderer(task)
      taskIds.add(task.id)
      rows.push({
        id: task.id,
        title: item.title,
        sourceUrl: item.url,
        kind: item.type,
        status: task.status,
        progress: Math.min(100, Math.max(0, (task.progress?.percent || 0) * 100)),
        createdAt: item.completedAt || item.startedAt || item.createdAt,
        filePath: task.output?.filePath,
        thumbnail: item.thumbnail,
        error: item.error
      })
    }
    cursor = result.nextCursor
  } while (cursor)
  const imagePaths = new Set(rows.filter((row) => row.kind === 'image').map((row) => row.filePath))
  for (const item of workspace) {
    if (
      item.kind === 'auto' ||
      (item.taskId && taskIds.has(item.taskId)) ||
      (item.kind === 'image' && item.filePath && imagePaths.has(item.filePath))
    ) {
      continue
    }
    if (
      !['queued', 'downloading', 'paused', 'completed', 'failed'].includes(item.status) ||
      item.errorStage === 'fetch'
    ) {
      continue
    }
    rows.push({
      id: item.id,
      title: item.title,
      sourceUrl: item.sourceUrl,
      kind: item.options.output,
      status: item.status,
      progress: item.progress,
      createdAt: 0,
      filePath: item.filePath,
      thumbnail: item.image?.previewUrl || item.image?.url || item.info?.thumbnail,
      error: item.error
    })
  }
  return filterDownloadLibrary(rows, kind, query.slice(0, 500), page)
}

/** Resolve only database-owned downloads; callers cannot supply arbitrary file paths. */
export async function savedDownloadForPreview(id: string): Promise<MixedEntry | undefined> {
  await startDesktopTaskQueue()
  const image = savedImageDownloads().find((row) => row.id === id)
  const task = getDesktopTaskQueue().get(id)
  let record: DownloadLibraryEntry | undefined = image
  if (!record && task && isMediaTaskKind(task.kind)) {
    const row = projectTaskForRenderer(task)
    record = {
      id,
      title: row.title,
      sourceUrl: row.url,
      kind: row.type,
      status: task.status,
      progress: 100,
      createdAt: row.createdAt,
      filePath: task.output?.filePath
    }
  }
  return record
    ? {
        id: record.id,
        title: record.title,
        sourceUrl: record.sourceUrl,
        kind: record.kind,
        status: 'completed',
        selected: false,
        progress: 100,
        filePath: record.filePath,
        options: { ...emptyMixedOptions(), output: record.kind }
      }
    : undefined
}
