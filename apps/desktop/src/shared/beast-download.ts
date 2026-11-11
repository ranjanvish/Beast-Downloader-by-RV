import type { VideoFormat } from './types'

/** Preserve the chosen language instead of falling back to unrelated source audio. */
export function beastVideoSelector(video: VideoFormat, audio?: VideoFormat): string {
  if (!audio) {
    return video.format_id
  }
  const separateAudio = !audio.vcodec || audio.vcodec === 'none'
  if (separateAudio) {
    const videoOnly = !video.acodec || video.acodec === 'none'
    const equivalent =
      videoOnly && video.height && video.vcodec && /^[a-zA-Z0-9.]+$/.test(video.vcodec)
        ? `(${video.format_id}/bestvideo[height=${video.height}][ext=${video.ext}][vcodec=${video.vcodec}]${video.fps ? `[fps=${video.fps}]` : ''})`
        : video.format_id
    const videoSelector = videoOnly ? equivalent : `bestvideo[height=${video.height || 2160}]`
    return `${videoSelector}+${audio.format_id}`
  }
  // Muxed formats already contain audio: retain the selected resolution when its language matches.
  if (video.acodec && video.acodec !== 'none' && video.language === audio.language) {
    return video.format_id
  }
  return audio.format_id
}

/** Distinct variants must not reuse a previously saved full video or differently dubbed file. */
export function beastFilenameVariant(options: {
  type: 'video' | 'audio'
  format: string
  videoId?: string
  audioFormat?: string
  language?: string
  bitrate?: number
  startTime?: string
  endTime?: string
}): string {
  const safe = (value: string) => value.replace(/[^a-zA-Z0-9-]/g, '-')
  const tags = [options.type, safe(options.format)]
  if (options.language) {
    tags.push(safe(options.language))
  }
  if (options.bitrate) {
    tags.push(`${options.bitrate}k`)
  }
  if (options.startTime || options.endTime) {
    tags.push(`clip-${safe(options.startTime || '0')}-${safe(options.endTime || 'end')}`)
  }
  // Windows output is truncated to 50 characters. Put a compact identity first
  // so even long titles and ranges differing only at the end remain distinct.
  const identity = JSON.stringify([options.videoId, options.audioFormat, ...tags])
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < identity.length; index += 1) {
    // biome-ignore lint/suspicious/noBitwiseOperators: FNV-1a uses XOR for the filename identity.
    hash = BigInt.asUintN(64, (hash ^ BigInt(identity.charCodeAt(index))) * 0x100000001b3n)
  }
  return `[${options.type}-${hash.toString(16).padStart(16, '0')}] %(title).80B.%(ext)s`
}
