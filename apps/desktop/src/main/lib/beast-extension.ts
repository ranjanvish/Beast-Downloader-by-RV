import { randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isIP } from 'node:net'
import { beastFilenameVariant, beastVideoSelector } from '../../shared/beast-download'
import { isExtensionSourceUrl } from '../../shared/extension-source-url'
import type { VideoInfo } from '../../shared/types'
import { convertBeastImage } from './beast-image-converter'
import { downloadEngine } from './download-facade'
import { replyExtensionJson } from './extension-origin'
import { fetchVideoInfo } from './yt-dlp-info'

const tickets = new Map<string, { url: string; info: VideoInfo; expires: number; origin: string }>()
let active = 0
let lastSeen = 0
export const beastExtensionStatus = () => ({ connected: Date.now() - lastSeen < 90_000, lastSeen })

/** Reject local destinations before delegating to the site extractor. */
export async function assertBeastSource(value: unknown): Promise<string> {
  if (typeof value !== 'string' || !isExtensionSourceUrl(value)) {
    throw new Error('Only public HTTP(S) media pages are supported.')
  }
  const url = new URL(value)
  const addresses = await lookup(url.hostname, { all: true })
  if (
    !addresses.length ||
    addresses.some(({ address }) => {
      if (isIP(address) === 6) {
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
        (a === 192 && b === 168) ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 198 && (b === 18 || b === 19))
      )
    })
  ) {
    throw new Error('Local and private network addresses are not available to the extension.')
  }
  return url.href
}

const readBody = async (req: IncomingMessage, limit = 24_000): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) {
      throw new Error('Request is too large.')
    }
    chunks.push(chunk)
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid request.')
  }
  return parsed as Record<string, unknown>
}

export async function handleBeastRequest(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  origin: string
): Promise<void> {
  if (req.method !== 'POST') {
    replyExtensionJson(res, 405, { error: 'POST required' })
    return
  }
  if (active >= 2) {
    replyExtensionJson(res, 429, { error: 'Another lookup is running. Try again shortly.' })
    return
  }
  active++
  lastSeen = Date.now()
  try {
    for (const [key, ticket] of tickets) {
      if (ticket.expires < Date.now()) {
        tickets.delete(key)
      }
    }
    const body = await readBody(req, path === '/beast/image' ? 29_000_000 : 24_000)
    if (path === '/beast/image') {
      try {
        replyExtensionJson(res, 200, await convertBeastImage(body))
      } catch {
        replyExtensionJson(res, 400, {
          error:
            'Image conversion failed: this file may be damaged, too large, or use an unsupported camera codec. Try another available size or save the original.'
        })
      }
      return
    }
    if (path === '/beast/info') {
      if (tickets.size >= 12) {
        tickets.delete(tickets.keys().next().value as string)
      }
      const url = await assertBeastSource(body.url)
      const info = await fetchVideoInfo(url, AbortSignal.timeout(90_000))
      const ticket = randomUUID()

      // Never expose signed URLs, cookies or fragment lists to extension storage.
      const formats = (info.formats || [])
        .filter((f) => /^[a-zA-Z0-9._-]{1,100}$/.test(f.format_id))
        .map((f) => ({
          format_id: f.format_id,
          ext: f.ext,
          height: f.height,
          width: f.width,
          fps: f.fps,
          vcodec: f.vcodec,
          // Extractors can identify an audio-only stream without knowing its codec.
          acodec: f.acodec || (f.vcodec === 'none' ? 'unknown' : undefined),
          language: f.language,
          tbr: f.tbr,
          format_note: f.format_note,
          protocol: f.protocol,
          filesize: f.filesize || f.filesize_approx
        }))
      tickets.set(ticket, {
        url,
        info: { id: info.id, title: info.title, duration: info.duration, formats },
        expires: Date.now() + 5 * 60_000,
        origin
      })
      replyExtensionJson(res, 200, { ticket, title: info.title, duration: info.duration, formats })
      return
    }
    if (path !== '/beast/download') {
      throw new Error('Unknown operation.')
    }
    const ticket = typeof body.ticket === 'string' ? tickets.get(body.ticket) : undefined
    if (!ticket || ticket.origin !== origin) {
      throw new Error('Selection expired. Analyze the page again.')
    }
    const { info, url } = ticket
    await assertBeastSource(url)
    const audio = info.formats.find(
      (f) => f.format_id === body.audioId && f.acodec && f.acodec !== 'none'
    )
    const video = info.formats.find(
      (f) => f.format_id === body.videoId && f.vcodec && f.vcodec !== 'none'
    )
    if (
      (body.type === 'audio' && !audio) ||
      (body.type === 'video' && (!video || (!audio && body.audioId !== 'none'))) ||
      !['audio', 'video'].includes(String(body.type))
    ) {
      throw new Error('Choose an available video and audio track.')
    }
    if (![0, 64, 96, 128, 160, 192, 256, 320].includes(Number(body.bitrate))) {
      throw new Error('Invalid audio bitrate.')
    }
    const start = Number(body.start || 0),
      end = Number(body.end || 0)
    if (
      !(Number.isFinite(start) && Number.isFinite(end)) ||
      start < 0 ||
      end < 0 ||
      (end > 0 && end <= start) ||
      (start > 0 && !end) ||
      (info.duration && end > info.duration)
    ) {
      throw new Error('Invalid clip range.')
    }
    const type = body.type === 'audio' ? 'audio' : 'video'
    const format =
      type === 'audio'
        ? audio?.format_id
        : video && audio
          ? beastVideoSelector(video, audio)
          : video?.format_id
    if (!format) {
      throw new Error('Choose an available video and audio track.')
    }
    const id = randomUUID()
    downloadEngine.startDownload(id, {
      url,
      type,
      format,
      audioFormat: type === 'video' ? '' : undefined,
      audioBitrate: Number(body.bitrate) || undefined,
      embedAudioCover: type === 'audio' ? body.embedAudioCover !== false : undefined,
      editorCompatible: type === 'video' && body.editorCompatible === true,
      downloadSubs: body.downloadSubs === true,
      ...(end ? { startTime: String(start), endTime: String(end) } : {}),
      title: info.title,
      duration: info.duration,
      thumbnail: info.thumbnail,
      selectedFormat: type === 'audio' ? audio : video,
      customFilenameTemplate: beastFilenameVariant({
        type,
        format: body.editorCompatible === true ? `${format}-editor-mp4` : format,
        videoId: info.id,
        audioFormat: audio?.format_id,
        language: audio?.language,
        bitrate: Number(body.bitrate),
        startTime: String(start),
        endTime: String(end)
      })
    })
    tickets.delete(String(body.ticket))
    replyExtensionJson(res, 200, { id, queued: true })
  } catch (error) {
    // Extractor errors may contain signed URLs or cookies. Do not forward raw stderr.
    const message = error instanceof Error ? error.message : ''
    const safe =
      /^(Only public|Local and private|Request is|Invalid|Unknown operation|Selection expired|Choose an available)/.test(
        message
      )
    replyExtensionJson(res, 400, {
      error: safe
        ? message
        : 'Could not read or queue this media. Try Rescan; check the desktop app for site access or cookie settings.'
    })
  } finally {
    active--
  }
}
