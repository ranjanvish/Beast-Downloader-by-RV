import { randomUUID } from 'node:crypto'
import type { ImageScan } from '../../shared/image-download'
import {
  audioFormats,
  type BatchBulkOptions,
  type BatchSnapshot,
  type BatchStatus,
  bestVideoAt,
  emptyMixedOptions,
  guessMediaKind,
  isPlaylistUrl,
  type MediaKind,
  type MixedEntry,
  type MixedOptions,
  optionsForImage,
  parseMixedUrls,
  validateMixedOptions,
  videoFormats
} from '../../shared/mixed-download'
import type { VideoInfo } from '../../shared/types'

export interface BatchDependencies {
  playlist?: (url: string) => Promise<{ entries: { url: string }[] }>
  videoInfo: (url: string) => Promise<VideoInfo>
  images: (url: string) => Promise<ImageScan>
  saveImage: (entry: MixedEntry) => Promise<string>
  startMedia: (entry: MixedEntry) => Promise<string>
  mediaState: (
    id: string
  ) => { status: string; progress: number; path?: string; error?: string } | undefined
  cancelMedia: (id: string) => Promise<void>
  resumeMedia: (id: string) => Promise<void>
  persist: (items: MixedEntry[]) => void
}

const editable = new Set<BatchStatus>(['pending', 'ready', 'failed', 'cancelled'])
const active = new Set<BatchStatus>(['fetching', 'queued', 'downloading', 'paused'])
const isCancelled = (entry: MixedEntry): boolean => entry.status === 'cancelled'

/** A paginated, persistent workspace; batches have no fixed item-count cap. */
export class MixedBatch {
  readonly items: MixedEntry[]
  paused = false
  concurrency = 3
  private fetching = false
  private fetchCursor = 0
  private activeImages = 0
  private readonly timer: ReturnType<typeof setInterval>
  private readonly dependencies: BatchDependencies
  constructor(dependencies: BatchDependencies, saved: MixedEntry[] = []) {
    this.dependencies = dependencies
    this.items = saved.map((item) => ({
      ...item,
      options:
        item.info &&
        item.options.audioTrack &&
        !audioFormats(item.info).some((f) => f.format_id === item.options.audioTrack)
          ? {
              ...item.options,
              imageUrl:
                item.options.imageUrl ||
                item.info.thumbnail ||
                item.info.thumbnails?.at(-1)?.url ||
                '',
              audioTrack: audioFormats(item.info)[0]?.format_id || ''
            }
          : {
              ...item.options,
              imageUrl:
                item.options.imageUrl ||
                item.info?.thumbnail ||
                item.info?.thumbnails?.at(-1)?.url ||
                ''
            },
      status:
        ['fetching', 'queued', 'downloading'].includes(item.status) && !item.taskId
          ? item.info || item.image
            ? 'ready'
            : 'pending'
          : item.status
    }))
    this.timer = setInterval(() => this.tick(), 750)
    this.timer.unref?.()
  }
  dispose() {
    clearInterval(this.timer)
  }
  private changed() {
    this.dependencies.persist(this.items)
  }
  private entry(url: string): MixedEntry {
    return {
      id: randomUUID(),
      sourceUrl: url,
      title: url,
      kind: 'auto',
      selected: true,
      status: 'pending',
      progress: 0,
      options: emptyMixedOptions()
    }
  }
  add(text: string) {
    if (typeof text !== 'string' || text.length > 2_000_000) {
      throw new Error('Paste a smaller text chunk; you can append more links to the same batch.')
    }
    const parsed = parseMixedUrls(
      text,
      this.items.flatMap((item) => [
        item.sourceUrl,
        ...(item.image ? [item.image.url] : []),
        ...(item.pageUrl && isPlaylistUrl(item.pageUrl) ? [item.pageUrl] : [])
      ])
    )
    const entries = parsed.urls.map((url) => this.entry(url))
    this.items.push(...entries)
    this.changed()
    return {
      added: parsed.urls.length,
      ids: entries.map((entry) => entry.id),
      duplicates: parsed.duplicates,
      invalid: parsed.invalid
    }
  }
  importImages(scan: ImageScan) {
    let added = 0
    const seen = new Set(this.items.map((item) => item.image?.url))
    for (const image of scan.images) {
      if (seen.has(image.url)) {
        continue
      }
      seen.add(image.url)
      this.items.push({
        ...this.entry(image.url),
        kind: 'image',
        status: 'ready',
        title: image.title || image.url,
        image,
        pageUrl: scan.pageUrl,
        options: optionsForImage(image)
      })
      added++
    }
    this.changed()
    return { added }
  }
  private setMedia(item: MixedEntry, info: VideoInfo, force?: MediaKind) {
    if (
      info.formats?.length &&
      info.formats.every((format) =>
        /^(png|jpe?g|webp|gif|avif|bmp|svg|tiff?|heic|ico)$/i.test(format.ext)
      )
    ) {
      throw new Error('No video: this source is an image.')
    }
    const video = videoFormats(info)
    if (!info.formats.length) {
      throw new Error('This source did not expose downloadable media formats.')
    }
    item.info = info
    item.kind = video.length ? 'video' : 'audio'
    item.title = info.title
    item.options = {
      ...item.options,
      imageUrl: info.thumbnail || info.thumbnails?.at(-1)?.url || '',
      output: force === 'audio' || !video.length ? 'audio' : 'video',
      videoFormat: bestVideoAt(info),
      audioTrack:
        (audioFormats(info).find((f) => f.vcodec === 'none') || audioFormats(info)[0])?.format_id ||
        ''
    }
  }
  private async fetchOne(item: MixedEntry) {
    const requested = item.kind
    item.status = 'fetching'
    item.error = undefined
    this.changed()
    try {
      if (requested !== 'image' && isPlaylistUrl(item.sourceUrl) && this.dependencies.playlist) {
        const parent = item.sourceUrl
        const playlist = await this.dependencies.playlist(parent)
        if (isCancelled(item)) {
          return
        }
        const seen = new Set(
          this.items.filter((row) => row.id !== item.id).map((row) => row.sourceUrl)
        )
        const urls = parseMixedUrls(
          playlist.entries.map((entry) => entry.url).join('\n'),
          seen
        ).urls
        if (!urls.length) {
          throw new Error('This playlist is empty, unavailable, or already included in the queue.')
        }
        item.sourceUrl = urls[0]
        item.pageUrl = parent
        this.items.push(
          ...urls.slice(1).map((url) => ({ ...this.entry(url), kind: requested, pageUrl: parent }))
        )
      }
      const guess = requested === 'auto' ? guessMediaKind(item.sourceUrl) : requested
      let images: ImageScan | undefined
      if (guess === 'image') {
        const refreshPage = item.pageUrl?.startsWith('https://commons.wikimedia.org/wiki/File:')
        const scan = await this.dependencies.images(
          refreshPage && item.pageUrl ? item.pageUrl : item.image?.url || item.sourceUrl
        )
        if (item.image && refreshPage) {
          const current = scan.images.find((image) => image.url === item.image?.url)
          if (!current) {
            throw new Error('The selected image is no longer available on its source page.')
          }
          images = { ...scan, images: [current] }
        } else {
          images = scan
        }
      } else {
        try {
          this.setMedia(item, await this.dependencies.videoInfo(item.sourceUrl), guess)
        } catch (error) {
          if (guess !== 'auto') {
            throw error
          }
          if (
            !/unsupported URL|no video|no formats|did not expose|does not contain|unsupported media/i.test(
              error instanceof Error ? error.message : String(error)
            )
          ) {
            throw error
          }
          try {
            images = await this.dependencies.images(item.sourceUrl)
          } catch {
            throw error
          }
        }
      }
      if (isCancelled(item)) {
        return
      }
      if (images) {
        if (!images.images.length) {
          throw new Error(
            'No images were readable in this page HTML. Use the browser extension to send images from the open page.'
          )
        }
        const first = images.images[0]
        const old = item.options
        item.image = first
        item.kind = 'image'
        item.title = first.title || first.url
        item.pageUrl = images.pageUrl
        item.options = {
          ...optionsForImage(first),
          imageOutput: old.imageOutput,
          folder: old.folder
        }
        if (images.images.length > 1) {
          this.importImages({ ...images, images: images.images.slice(1) })
        }
      }
      item.status = 'ready'
      item.progress = 0
    } catch (error) {
      if (!isCancelled(item)) {
        item.status = 'failed'
        item.errorStage = 'fetch'
        const message = error instanceof Error ? error.message : String(error)
        item.error =
          /instagram/i.test(item.sourceUrl) && /content isn't available to everyone/i.test(message)
            ? `Instagram restricted access to this reel. Sign in to an Instagram account that can view it, connect the browser extension or configure browser cookies in Settings, then fetch again.

${message}`
            : message
      }
    }
    this.changed()
  }
  fetch(ids?: string[]) {
    this.fetchCursor = 0
    if (ids) {
      for (const item of this.items) {
        if (ids.includes(item.id) && editable.has(item.status)) {
          item.status = 'pending'
          item.error = undefined
          item.taskId = undefined
        }
      }
    }
    if (this.fetching) {
      return
    }
    this.fetching = true
    const worker = async () => {
      for (;;) {
        let item: MixedEntry | undefined
        while (this.fetchCursor < this.items.length) {
          const candidate = this.items[this.fetchCursor++]
          if (candidate.status === 'pending') {
            item = candidate
            break
          }
        }
        if (!item) {
          return
        }
        await this.fetchOne(item)
      }
    }
    void Promise.all([worker(), worker(), worker()]).finally(() => {
      this.fetching = false
      this.changed()
      if (this.items.some((item) => item.status === 'pending')) {
        this.fetch()
      }
    })
  }
  patch(id: string, patch: Partial<MixedOptions> & { kind?: MediaKind }) {
    const item = this.items.find((row) => row.id === id)
    if (!(item && editable.has(item.status))) {
      throw new Error('Wait for this item or prepare it again before changing options.')
    }
    if (patch.kind) {
      if (!['auto', 'video', 'audio', 'image'].includes(patch.kind)) {
        throw new Error('Unsupported media type.')
      }
      item.kind = patch.kind
      item.info = undefined
      item.image = undefined
      item.status = 'pending'
    }
    const options = { ...item.options, ...patch }
    if (patch.videoFormat !== undefined) options.maxShortEdge = undefined
    if (item.info || item.image) {
      validateMixedOptions(item, options)
    }
    item.options = options
    this.changed()
  }
  bulk(patch: BatchBulkOptions) {
    let changed = 0
    const errors: string[] = []
    for (const item of this.items) {
      if (!(item.selected && editable.has(item.status) && (item.info || item.image))) {
        continue
      }
      const options = { ...item.options }
      if (patch.imageWidth !== undefined) {
        const candidates = item.image
          ? [{ url: item.image.url, width: item.image.width }, ...item.image.variants]
          : item.info?.thumbnails || []
        const known = candidates
          .filter((candidate) => candidate.width)
          .sort((a, b) => (b.width || 0) - (a.width || 0))
        const limit = patch.imageWidth
        const chosen =
          limit === 0 ? known[0] : known.find((candidate) => (candidate.width || 0) <= limit)
        if (chosen) {
          options.imageUrl = chosen.url
        }
      }
      if (patch.folder !== undefined) {
        options.folder = patch.folder
      }
      if (item.kind === 'image') {
        if (patch.imageOutput) {
          options.imageOutput = patch.imageOutput
        }
      } else {
        if (patch.output) {
          options.output = patch.output
        }
        if (patch.saveThumbnail !== undefined) {
          options.saveThumbnail = patch.saveThumbnail
        }
        if (patch.imageOutput) {
          options.imageOutput = patch.imageOutput
        }
        if (patch.height !== undefined && videoFormats(item.info).length) {
          options.videoFormat = bestVideoAt(item.info, patch.height)
          options.maxShortEdge = patch.height || undefined
        }
        if (patch.audioOutput) {
          options.audioOutput = patch.audioOutput
        }
        if (patch.audioBitrate !== undefined) {
          options.audioBitrate = patch.audioBitrate
        }
        if (patch.container) {
          options.container = patch.container
        }
      }
      try {
        validateMixedOptions(item, options)
        item.options = options
        changed++
      } catch (error) {
        errors.push(`${item.title}: ${error instanceof Error ? error.message : error}`)
      }
    }
    this.changed()
    return { changed, errors }
  }
  select(ids: string[] | 'all' | 'none', selected = true) {
    for (const item of this.items) {
      if (ids === 'all' || ids === 'none' || ids.includes(item.id)) {
        item.selected = ids === 'none' ? false : selected
      }
    }
    this.changed()
  }
  start(ids?: string[]) {
    let queued = 0
    for (const item of this.items) {
      if (!(ids ? ids.includes(item.id) : item.selected)) {
        continue
      }
      if (item.status === 'paused' && item.taskId) {
        item.status = 'downloading'
        void this.dependencies.resumeMedia(item.taskId).catch((error) => {
          item.status = 'failed'
          item.error = String(error)
          this.changed()
        })
        queued++
        continue
      }
      if (
        item.status !== 'ready' &&
        item.status !== 'cancelled' &&
        !(item.status === 'failed' && item.errorStage === 'download')
      ) {
        continue
      }
      try {
        validateMixedOptions(item, item.options)
        item.status = 'queued'
        item.error = undefined
        item.taskId = undefined
        queued++
      } catch (error) {
        item.error = error instanceof Error ? error.message : String(error)
      }
    }
    this.paused = false
    this.changed()
    this.tick()
    return { queued }
  }
  retry() {
    const fetch: string[] = [],
      download: string[] = []
    for (const item of this.items) {
      if (item.status === 'failed' && item.selected) {
        if (item.errorStage === 'fetch') {
          fetch.push(item.id)
        } else {
          download.push(item.id)
        }
      }
    }
    if (fetch.length) {
      this.fetch(fetch)
    }
    if (download.length) {
      this.start(download)
    }
    return { fetching: fetch.length, downloading: download.length }
  }
  async cancel(ids: string[]) {
    for (const item of this.items) {
      if (ids.includes(item.id)) {
        if (item.status === 'completed') {
          continue
        }
        if (item.status === 'downloading' && item.options.output === 'image') {
          continue
        }
        if (item.taskId && active.has(item.status)) {
          await this.dependencies.cancelMedia(item.taskId)
        }
        item.status = 'cancelled'
      }
    }
    this.changed()
  }
  remove(ids: string[]) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (ids.includes(this.items[i].id) && !active.has(this.items[i].status)) {
        this.items.splice(i, 1)
      }
    }
    this.changed()
  }
  createClips(id: string, value: unknown, start: boolean) {
    const source = this.items.find((row) => row.id === id)
    if (!(source?.info && source.kind !== 'image' && Array.isArray(value) && value.length)) {
      throw new Error('Fetch a video or audio source and add at least one clip.')
    }
    const clips = value.map((range: unknown, index: number) => {
      if (
        !range ||
        typeof range !== 'object' ||
        !('start' in range) ||
        !('end' in range) ||
        typeof range.start !== 'string' ||
        typeof range.end !== 'string' ||
        !range.start.trim() ||
        !range.end.trim()
      ) {
        throw new Error('Each clip needs a start and end time.')
      }
      const options = { ...source.options, start: range.start, end: range.end }
      validateMixedOptions(source, options)
      return {
        ...structuredClone(source),
        id: randomUUID(),
        clipNumber: index + 1,
        options,
        taskId: undefined,
        filePath: undefined,
        status: 'ready' as const,
        progress: 0,
        error: undefined,
        errorStage: undefined,
        selected: true
      }
    })
    this.items.push(...clips)
    this.changed()
    return start ? this.start(clips.map((clip) => clip.id)) : { created: clips.length }
  }
  clone(id: string) {
    const item = this.items.find((row) => row.id === id)
    if (!(item && (item.info || item.image))) {
      throw new Error('Fetch this item before duplicating it.')
    }
    this.items.push({
      ...structuredClone(item),
      id: randomUUID(),
      clipNumber: undefined,
      taskId: undefined,
      filePath: undefined,
      status: 'ready',
      progress: 0,
      error: undefined,
      selected: true
    })
    this.changed()
  }
  private async run(item: MixedEntry) {
    item.status = 'downloading'
    item.progress = 0
    const isImage = item.options.output === 'image'
    if (isImage) {
      this.activeImages++
    }
    try {
      if (isImage) {
        item.filePath = await this.dependencies.saveImage(structuredClone(item))
        item.status = 'completed'
        item.progress = 100
      } else {
        if (item.options.saveThumbnail && !item.thumbnailPath) {
          item.thumbnailPath = await this.dependencies.saveImage(structuredClone(item))
        }
        const id = await this.dependencies.startMedia(structuredClone(item))
        item.taskId = id
        if (isCancelled(item)) {
          await this.dependencies.cancelMedia(id)
        }
      }
    } catch (error) {
      if (!isCancelled(item)) {
        item.status = 'failed'
        item.errorStage = 'download'
        item.error = error instanceof Error ? error.message : String(error)
      }
    } finally {
      if (isImage) {
        this.activeImages--
      }
      this.changed()
    }
  }
  tick() {
    for (const item of this.items) {
      if (!(item.taskId && ['queued', 'downloading', 'paused'].includes(item.status))) {
        continue
      }
      const task = this.dependencies.mediaState(item.taskId)
      if (!task) {
        item.status = 'failed'
        item.errorStage = 'download'
        item.error = 'The queued task was removed. Retry to create a new task.'
        this.changed()
        continue
      }
      item.progress = task.progress
      if (task.status === 'completed') {
        item.status = 'completed'
        item.filePath = task.path
        item.progress = 100
        this.changed()
      } else if (task.status === 'failed' || task.status === 'cancelled') {
        item.status = task.status
        item.error = task.error
        item.errorStage = 'download'
        this.changed()
      } else {
        item.status = task.status === 'paused' ? 'paused' : 'downloading'
      }
    }
    if (this.paused) {
      return
    }
    let available =
      this.concurrency - this.items.filter((item) => item.status === 'downloading').length
    for (const item of this.items) {
      if (available <= 0) {
        break
      }
      if (
        item.status !== 'queued' ||
        item.taskId ||
        (item.options.output === 'image' && this.activeImages > 0)
      ) {
        continue
      }
      available--
      void this.run(item)
    }
  }
  snapshot(page = 0, query = '', status = 'all'): BatchSnapshot {
    const counts: BatchSnapshot['counts'] = {
      pending: 0,
      fetching: 0,
      ready: 0,
      queued: 0,
      downloading: 0,
      paused: 0,
      completed: 0,
      failed: 0,
      cancelled: 0
    }
    for (const item of this.items) {
      counts[item.status]++
    }
    const filtered = this.items.filter(
      (item) =>
        (status === 'all' || item.status === status || item.kind === status) &&
        `${item.title} ${item.sourceUrl}`.toLowerCase().includes(query.toLowerCase())
    )
    const pages = Math.max(1, Math.ceil(filtered.length / 20))
    const current = Math.max(0, Math.min(Number.isFinite(page) ? Math.floor(page) : 0, pages - 1))
    return {
      items: filtered.slice(current * 20, current * 20 + 20),
      page: current,
      pages,
      total: this.items.length,
      filtered: filtered.length,
      counts,
      selected: this.items.filter((item) => item.selected).length,
      downloadableSelected: this.items.filter(
        (item) =>
          item.selected &&
          (item.status === 'ready' ||
            item.status === 'paused' ||
            (item.status === 'failed' && item.errorStage === 'download'))
      ).length,
      paused: this.paused,
      fetching: this.fetching,
      concurrency: this.concurrency
    }
  }
}
