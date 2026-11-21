import { lookup } from 'node:dns/promises'
import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import { isExtensionSourceUrl } from '../../shared/extension-source-url'
import { audioFormats, videoFormats } from '../../shared/mixed-download'
import type { VideoFormat, VideoInfo } from '../../shared/types'
import { savedDownloadForPreview } from './download-library'
import { getMixedBatch } from './mixed-batch-host'
import { fetchVideoInfo } from './yt-dlp-info'

const metadata = new Map<string, { expires: number; value: Promise<VideoInfo> }>()

export function selectPreviewStreams(info: VideoInfo) {
  const usable = (format: VideoFormat) =>
    format.url &&
    /^https?:/.test(format.url) &&
    !format.protocol?.includes('m3u8') &&
    !format.protocol?.includes('dash')
  const videos = videoFormats(info).filter(usable)
  const combined = videos.find(
    (f) => f.ext === 'mp4' && f.acodec && f.acodec !== 'none' && (f.height || 0) <= 1080
  )
  const video =
    combined || videos.find((f) => f.ext === 'mp4' && (f.height || 0) <= 1080) || videos[0]
  const audio =
    audioFormats(info)
      .filter(usable)
      .find((f) => f.ext === 'm4a' || f.ext === 'mp3') || audioFormats(info).find(usable)
  return { video, audio: video?.acodec && video.acodec !== 'none' ? undefined : audio }
}

/** Revalidate every redirect; never expose arbitrary local paths through the preview protocol. */
export async function fetchPublicPreviewResource(
  url: string,
  headers: Headers,
  signal: AbortSignal
): Promise<Response> {
  let current = url
  for (let hop = 0; hop < 6; hop++) {
    if (!isExtensionSourceUrl(current)) {
      throw new Error('Only public media is supported')
    }
    const addresses = await lookup(new URL(current).hostname, { all: true })
    if (
      !addresses.length ||
      addresses.some(({ address, family }) => {
        if (family === 6) {
          return !/^[23][0-9a-f]{3}:/i.test(address)
        }
        const [a, b] = address.split('.').map(Number)
        return (
          a === 0 ||
          a === 10 ||
          a === 127 ||
          a >= 224 ||
          (a === 169 && b === 254) ||
          (a === 172 && b >= 16 && b <= 31) ||
          (a === 192 && (b === 168 || b === 0)) ||
          (a === 100 && b >= 64 && b <= 127) ||
          (a === 198 && (b === 18 || b === 19))
        )
      })
    ) {
      throw new Error('Private media addresses are not supported')
    }
    // Node fetch returns manual redirects; Chromium net.fetch cancels them instead.
    const response = await globalThis.fetch(current, { headers, signal, redirect: 'manual' })
    if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
      await response.body?.cancel()
      current = new URL(response.headers.get('location') || '', current).href
      continue
    }
    return response
  }
  throw new Error('Too many media redirects')
}

export async function mixedPreview(id: string, refresh = false) {
  const item =
    getMixedBatch().items.find((row) => row.id === id || row.taskId === id) ||
    (await savedDownloadForPreview(id))
  if (!item) {
    throw new Error('This item is no longer in the workspace')
  }
  if (item.filePath) {
    return { src: `batch-media://${id}/saved`, kind: item.options.output, audioSrc: undefined }
  }
  if (item.kind === 'image') {
    return { src: `batch-media://${id}/image`, kind: 'image', audioSrc: undefined }
  }
  if (refresh) {
    metadata.delete(id)
  }
  const saved = metadata.get(id)
  let value: Promise<VideoInfo>
  if (saved && saved.expires > Date.now()) {
    value = saved.value
  } else {
    if (metadata.size >= 32) {
      metadata.delete(metadata.keys().next().value || '')
    }
    value = fetchVideoInfo(item.sourceUrl)
    metadata.set(id, { expires: Date.now() + 240_000, value })
    value.catch(() => metadata.delete(id))
  }
  const streams = selectPreviewStreams(await value)
  if (item.kind === 'audio') {
    if (!(streams.audio || (streams.video?.acodec && streams.video.acodec !== 'none'))) {
      throw new Error('No browser-playable audio stream is available. Download to preview locally.')
    }
    return { src: `batch-media://${id}/audio`, kind: 'audio', audioSrc: undefined }
  }
  if (!streams.video) {
    throw new Error('No browser-playable video stream is available. Download to preview locally.')
  }
  return {
    src: `batch-media://${id}/video`,
    kind: 'video',
    audioSrc: streams.audio ? `batch-media://${id}/audio` : undefined
  }
}

export function registerMixedPreviewProtocol() {
  protocol.handle('batch-media', async (request) => {
    try {
      const url = new URL(request.url)
      const item =
        getMixedBatch().items.find(
          (row) => row.id === url.hostname || row.taskId === url.hostname
        ) || (await savedDownloadForPreview(url.hostname))
      if (!(item && ['/saved', '/image', '/video', '/audio'].includes(url.pathname))) {
        return new Response(null, { status: 404 })
      }
      if (url.pathname === '/saved' && item.filePath) {
        return await net.fetch(pathToFileURL(item.filePath).href, {
          headers: request.headers,
          signal: request.signal
        })
      }
      let source: string | undefined
      if (url.pathname === '/image' && item.kind === 'image') {
        source = item.image?.previewUrl || item.options.imageUrl || item.image?.url
      } else {
        const cached = metadata.get(url.hostname)
        if (!cached || cached.expires <= Date.now()) {
          return new Response(null, { status: 410 })
        }
        cached.expires = Date.now() + 240_000
        const streams = selectPreviewStreams(await cached.value)
        source =
          url.pathname === '/video' ? streams.video?.url : streams.audio?.url || streams.video?.url
      }
      if (!source) {
        return new Response(null, { status: 404 })
      }
      const headers = new Headers()
      const range = request.headers.get('range')
      if (range) {
        headers.set('range', range)
      }
      return await fetchPublicPreviewResource(source, headers, request.signal)
    } catch {
      return new Response(null, { status: 502 })
    }
  })
}
