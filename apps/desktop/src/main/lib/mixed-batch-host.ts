import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { ImageScan } from '../../shared/image-download'
import {
  type BatchBulkOptions,
  type MixedBatchAction,
  type MixedEntry,
  type MixedOptions,
  mixedMediaOptions
} from '../../shared/mixed-download'
import type { VideoInfo } from '../../shared/types'
import { scopedLoggers } from '../utils/logger'
import { downloadEngine, prepareDownloadTaskInput } from './download-facade'
import { recordSavedImage } from './download-library-store'
import { saveImages, scanImages } from './image-downloads'
import { MixedBatch } from './mixed-batch'
import { getDesktopTaskQueue, startDesktopTaskQueue } from './task-queue-host'
import { fetchPlaylistInfo, fetchVideoInfo } from './yt-dlp-info'

let workspace: MixedBatch | undefined
let storageError: string | undefined
let storageTimer: ReturnType<typeof setTimeout> | undefined

/** Persist only the fields the chooser needs, never extractor cookies or HTTP headers. */
function chooserInfo(info: VideoInfo): VideoInfo {
  return {
    id: info.id,
    title: info.title,
    duration: info.duration,
    thumbnail: info.thumbnail,
    formats: (info.formats || []).map((f) => ({
      format_id: f.format_id,
      ext: f.ext,
      width: f.width,
      height: f.height,
      fps: f.fps,
      vcodec: f.vcodec,
      acodec: f.acodec,
      language: f.language,
      filesize: f.filesize,
      filesize_approx: f.filesize_approx,
      format_note: f.format_note,
      tbr: f.tbr
    }))
  }
}

export function getMixedBatch(): MixedBatch {
  if (workspace) {
    return workspace
  }
  const file = path.join(app.getPath('userData'), 'mixed-download-workspace.json')
  let saved: MixedEntry[] = []
  try {
    if (existsSync(file)) {
      const data = JSON.parse(readFileSync(file, 'utf8'))
      if (data.version === 1 && Array.isArray(data.items)) {
        saved = data.items
      }
    }
  } catch (error) {
    scopedLoggers.download.warn('Could not restore mixed download workspace', error)
  }
  const persistNow = () => {
    if (!workspace) {
      return
    }
    try {
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(`${file}.next`, JSON.stringify({ version: 1, items: workspace.items }))
      renameSync(`${file}.next`, file)
      storageError = undefined
    } catch (error) {
      storageError = `Workspace could not be saved: ${error instanceof Error ? error.message : error}`
      scopedLoggers.download.warn(storageError)
    }
  }
  let queueReady = false
  void startDesktopTaskQueue()
    .then(() => {
      queueReady = true
    })
    .catch((error) => scopedLoggers.download.warn('Mixed queue initialization failed', error))
  workspace = new MixedBatch(
    {
      videoInfo: async (url) => chooserInfo(await fetchVideoInfo(url)),
      playlist: fetchPlaylistInfo,
      images: scanImages,
      saveImage: async (item) => {
        const result = await saveImages({
          images: [{ url: item.options.imageUrl, title: item.title }],
          pageUrl: item.pageUrl,
          output: item.options.imageOutput,
          directory: item.options.folder || undefined
        })
        if (!result.saved[0]) {
          throw new Error(result.failed[0]?.error || 'The image download failed.')
        }
        return result.saved[0].path
      },
      startMedia: async (item) => {
        await startDesktopTaskQueue()
        queueReady = true
        const id = randomUUID()
        downloadEngine.restoreActiveDownloads()
        const input = await prepareDownloadTaskInput(id, {
          ...mixedMediaOptions(item),
          downloadSubs: false
        })
        await getDesktopTaskQueue().add({ id, input, priority: 0, maxAttempts: 3 })
        return id
      },
      mediaState: (id) => {
        if (!queueReady) {
          return { status: 'paused', progress: 0 }
        }
        const task = getDesktopTaskQueue().get(id)
        return task
          ? {
              status: task.status,
              progress: Math.min(100, Math.max(0, (task.progress?.percent || 0) * 100)),
              path: task.output?.filePath,
              error: task.lastError?.rawMessage || task.lastError?.uiMessageKey
            }
          : undefined
      },
      cancelMedia: async (id) => {
        await getDesktopTaskQueue().cancel(id)
      },
      resumeMedia: async (id) => {
        await getDesktopTaskQueue().resume(id)
      },
      persist: () => {
        if (!storageTimer) {
          storageTimer = setTimeout(() => {
            storageTimer = undefined
            persistNow()
          }, 300)
          storageTimer.unref()
        }
      }
    },
    saved
  )
  for (const row of saved) {
    if (row.kind === 'image' && row.status === 'completed' && row.filePath) {
      recordSavedImage(row.options.imageUrl || row.sourceUrl, row.filePath, row.title)
    }
  }
  app.once('will-quit', () => {
    if (storageTimer) {
      clearTimeout(storageTimer)
    }
    persistNow()
    workspace?.dispose()
  })
  return workspace
}

export function mixedBatchSnapshot(page = 0, query = '', status = 'all') {
  return { ...getMixedBatch().snapshot(page, query.slice(0, 500), status), storageError }
}

export async function executeMixedBatch(
  action: MixedBatchAction,
  body: Record<string, unknown> = {}
): Promise<unknown> {
  const batch = getMixedBatch()
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === 'string')
    : undefined
  switch (action) {
    case 'add':
      return batch.add(String(body.text || ''))
    case 'fetch':
      batch.fetch(ids)
      return { accepted: true }
    case 'patch':
      batch.patch(String(body.id || ''), (body.patch || {}) as Partial<MixedOptions>)
      return { changed: 1 }
    case 'bulk':
      return batch.bulk((body.patch || {}) as BatchBulkOptions)
    case 'select':
      batch.select(
        body.ids === 'all' || body.ids === 'none' ? body.ids : ids || [],
        body.selected !== false
      )
      return { selected: true }
    case 'start':
      return batch.start(ids)
    case 'pause':
      batch.paused = body.paused !== false
      return { paused: batch.paused }
    case 'retry':
      return batch.retry()
    case 'cancel':
      await batch.cancel(ids || batch.items.filter((item) => item.selected).map((item) => item.id))
      return { cancelled: true }
    case 'remove':
      batch.remove(
        body.finished
          ? batch.items
              .filter((row) => ['completed', 'cancelled'].includes(row.status))
              .map((row) => row.id)
          : ids || []
      )
      return { removed: true }
    case 'clone':
      batch.clone(String(body.id))
      return { duplicated: true }
    case 'importImages':
      return batch.importImages(body.scan as ImageScan)
    case 'concurrency': {
      const count = Number(body.count)
      if (!Number.isInteger(count) || count < 1 || count > 8) {
        throw new Error('Choose 1–8 concurrent jobs.')
      }
      batch.concurrency = count
      return { concurrency: count }
    }
    default:
      throw new Error('Unsupported batch operation.')
  }
}
