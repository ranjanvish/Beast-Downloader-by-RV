import { beastFilenameVariant, beastVideoSelector } from './beast-download'
import type { ImageOutput, ImageScan, ImageSource } from './image-download'
import type { DownloadOptions, VideoFormat, VideoInfo } from './types'

export type MediaKind = 'auto' | 'image' | 'audio' | 'video'
export type BatchStatus =
  | 'pending'
  | 'fetching'
  | 'ready'
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
export interface MixedOptions {
  output: Exclude<MediaKind, 'auto'>
  videoFormat: string
  audioTrack: string
  audioOutput: string
  audioBitrate: number
  imageOutput: ImageOutput
  imageUrl: string
  container: 'auto' | 'mp4' | 'mkv' | 'webm'
  folder: string
  start: string
  end: string
}
export interface MixedEntry {
  id: string
  sourceUrl: string
  pageUrl?: string
  title: string
  kind: MediaKind
  status: BatchStatus
  selected: boolean
  progress: number
  options: MixedOptions
  info?: VideoInfo
  image?: ImageSource
  error?: string
  errorStage?: 'fetch' | 'download'
  taskId?: string
  filePath?: string
}
export interface BatchBulkOptions {
  output?: 'video' | 'audio'
  height?: number
  audioOutput?: string
  audioBitrate?: number
  imageOutput?: ImageOutput
  folder?: string
  container?: MixedOptions['container']
}
export interface BatchSnapshot {
  items: MixedEntry[]
  total: number
  filtered: number
  page: number
  pages: number
  counts: Record<BatchStatus, number>
  selected: number
  downloadableSelected: number
  paused: boolean
  fetching: boolean
  concurrency: number
  storageError?: string
}
export const emptyMixedOptions = (): MixedOptions => ({
  output: 'video',
  videoFormat: '',
  audioTrack: '',
  audioOutput: 'mp3',
  audioBitrate: 192,
  imageOutput: 'original',
  imageUrl: '',
  container: 'auto',
  folder: '',
  start: '',
  end: ''
})

export function parseMixedUrls(text: string, existing: Iterable<string> = []) {
  const seen = new Set(existing)
  const urls: string[] = [],
    invalid: string[] = []
  let duplicates = 0
  for (const line of text.split(/\r?\n|\s+(?=https?:\/\/)/)) {
    const value = line.trim().replace(/^\[[^\]]*\]\((https?:\/\/[^\s]+)\)$/, '$1')
    if (!value) {
      continue
    }
    try {
      const url = new URL(value)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new Error('Invalid URL')
      }
      if (seen.has(url.href)) {
        duplicates++
        continue
      }
      seen.add(url.href)
      urls.push(url.href)
    } catch {
      invalid.push(value.slice(0, 200))
    }
  }
  return { urls, duplicates, invalid }
}

export function guessMediaKind(url: string): MediaKind {
  const parsed = new URL(url)
  if (
    /\.(?:png|jpe?g|webp|gif|avif|bmp|tiff?|heic|svg|ico)$/i.test(parsed.pathname) ||
    parsed.searchParams.get('udm') === '2' ||
    parsed.searchParams.get('tbm') === 'isch'
  ) {
    return 'image'
  }
  if (/\.(?:mp3|m4a|aac|wav|flac|ogg|opus|aiff)$/i.test(parsed.pathname)) {
    return 'audio'
  }
  return 'auto'
}

export function isPlaylistUrl(value?: string): boolean {
  if (!value) {
    return false
  }
  try {
    const url = new URL(value)
    return (
      (/(^|\.)youtube\.com$/.test(url.hostname) &&
        url.searchParams.has('list') &&
        !url.searchParams.has('v')) ||
      (/(^|\.)soundcloud\.com$/.test(url.hostname) && url.pathname.includes('/sets/'))
    )
  } catch {
    return false
  }
}

export const videoFormats = (info?: VideoInfo): VideoFormat[] =>
  (info?.formats || [])
    .filter((f) => f.vcodec && f.vcodec !== 'none' && !f.format_note?.includes('storyboard'))
    .sort((a, b) => (b.height || 0) - (a.height || 0) || (b.fps || 0) - (a.fps || 0))
export const audioFormats = (info?: VideoInfo): VideoFormat[] =>
  (info?.formats || []).filter(
    (f) => f.acodec && f.acodec !== 'none' && !f.format_note?.toLowerCase().includes('storyboard')
  )

export function bestVideoAt(info: VideoInfo | undefined, height = 1080): string {
  const formats = videoFormats(info)
  return (
    (height === 0
      ? formats[0]
      : formats.find((f) => f.height && f.height <= height) || formats.at(-1)
    )?.format_id || ''
  )
}

export function optionsForImage(image: ImageSource): MixedOptions {
  const choices = [{ url: image.url, width: image.width }, ...image.variants].sort(
    (a, b) => (b.width || 0) - (a.width || 0)
  )
  return { ...emptyMixedOptions(), output: 'image', imageUrl: choices[0]?.url || image.url }
}

export function parseClipTime(text: string): number {
  return /^\d+(?::[0-5]?\d){0,2}(?:\.\d+)?$/.test(text)
    ? text.split(':').reduce((n, part) => n * 60 + Number(part), 0)
    : Number.NaN
}

export function formatClipTime(seconds: number): string {
  const value = Math.max(0, Math.round(seconds * 1000))
  const hours = Math.floor(value / 3_600_000)
  const minutes = Math.floor(value / 60_000) % 60
  const remainder = (value % 60_000) / 1000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${remainder.toFixed(3).padStart(6, '0')}`
}

export function validateMixedOptions(entry: MixedEntry, options: MixedOptions): void {
  if (
    typeof options.folder !== 'string' ||
    (options.folder.trim() && !/^(?:[a-z]:[\\/]|[\\/])/i.test(options.folder.trim()))
  ) {
    throw new Error('Choose an absolute download folder path, or leave it empty for the default.')
  }
  if (entry.kind === 'image' && options.output !== 'image') {
    throw new Error('Images must use an image output format.')
  }
  if (entry.kind !== 'image' && options.output === 'image') {
    throw new Error('Use Fetch as image to find images on this page.')
  }
  if (!['mp3', 'm4a', 'wav', 'flac', 'opus', 'ogg'].includes(options.audioOutput)) {
    throw new Error('Unsupported audio output format.')
  }
  if (![0, 128, 192, 256, 320].includes(options.audioBitrate)) {
    throw new Error('Choose a supported audio bitrate.')
  }
  if (!['original', 'png', 'jpeg', 'webp'].includes(options.imageOutput)) {
    throw new Error('Unsupported image output format.')
  }
  if (!['auto', 'mp4', 'mkv', 'webm'].includes(options.container)) {
    throw new Error('Unsupported video container.')
  }
  if (entry.info && options.output === 'audio' && !audioFormats(entry.info).length) {
    throw new Error('This source does not advertise an audio track.')
  }
  if (
    entry.info &&
    options.output === 'video' &&
    !videoFormats(entry.info).some((f) => f.format_id === options.videoFormat)
  ) {
    throw new Error('Choose a video resolution available from this source.')
  }
  if (
    options.audioTrack &&
    !audioFormats(entry.info).some((f) => f.format_id === options.audioTrack)
  ) {
    throw new Error('Choose an audio track available from this source.')
  }
  if (
    entry.image &&
    ![entry.image.url, ...entry.image.variants.map((v) => v.url)].includes(options.imageUrl)
  ) {
    throw new Error('Choose an image size advertised by this source.')
  }
  const start = options.start ? parseClipTime(options.start) : 0
  const end = options.end ? parseClipTime(options.end) : undefined
  if (!Number.isFinite(start) || (end !== undefined && (!Number.isFinite(end) || end <= start))) {
    throw new Error('Enter a valid start/end range, with end after start.')
  }
  if (
    entry.info?.duration &&
    (start >= entry.info.duration || (end !== undefined && end > entry.info.duration))
  ) {
    throw new Error('The selected range exceeds this media duration.')
  }
}

export function mixedMediaOptions(entry: MixedEntry): DownloadOptions {
  validateMixedOptions(entry, entry.options)
  const o = entry.options
  const type = o.output === 'audio' ? 'audio' : 'video'
  const video = videoFormats(entry.info).find((f) => f.format_id === o.videoFormat)
  const audio = audioFormats(entry.info).find((f) => f.format_id === o.audioTrack)
  const format =
    type === 'video' && video
      ? beastVideoSelector(video, audio)
      : audio?.format_id || 'bestaudio/best'
  return {
    url: entry.sourceUrl,
    type,
    format,
    audioFormat: type === 'video' ? '' : o.audioOutput,
    audioBitrate: type === 'audio' ? o.audioBitrate || undefined : undefined,
    customDownloadPath: o.folder || undefined,
    containerFormat: o.container,
    startTime: o.start || undefined,
    endTime: o.end || undefined,
    title: entry.title,
    thumbnail: entry.info?.thumbnail,
    duration: entry.info?.duration,
    selectedFormat: type === 'video' ? video : audio,
    customFilenameTemplate: beastFilenameVariant({
      type,
      format,
      videoId: `${entry.info?.id || ''}-${entry.id}`,
      audioFormat: `${o.audioOutput}-${audio?.format_id || ''}`,
      startTime: o.start,
      endTime: o.end,
      bitrate: type === 'audio' ? o.audioBitrate : undefined
    })
  }
}

export type MixedBatchAction =
  | 'add'
  | 'fetch'
  | 'patch'
  | 'bulk'
  | 'select'
  | 'start'
  | 'pause'
  | 'retry'
  | 'cancel'
  | 'remove'
  | 'clone'
  | 'importImages'
  | 'concurrency'
export type ImportedBatchImages = ImageScan
