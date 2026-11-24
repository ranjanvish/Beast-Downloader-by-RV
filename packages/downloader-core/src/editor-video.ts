import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { link, rename, stat, unlink } from 'node:fs/promises'
import path from 'node:path'

import { promisify } from 'node:util'

interface Stream {
  codec_type: string
  codec_name: string
  width?: number
  height?: number
  pix_fmt?: string
  disposition?: { attached_pic?: number }
}

/** Preserve compatible streams and convert only where the editing preset requires it. */
export async function createEditorVideo(
  source: string,
  ffmpegDirectory: string,
  signal: AbortSignal,
  maxShortEdge?: number
): Promise<string> {
  const parsed = path.parse(source)
  const output = path.join(parsed.dir, `${parsed.name}.editor-${randomUUID().slice(0, 8)}.mp4`)
  const binary = path.join(ffmpegDirectory, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  const probe = path.join(ffmpegDirectory, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
  const { stdout } = await promisify(execFile)(probe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', source], { signal, windowsHide: true })
  const metadata = JSON.parse(stdout)
  const streams = metadata.streams as Stream[]
  const video = streams.find((stream) => stream.codec_type === 'video' && !stream.disposition?.attached_pic)
  if (!video) throw new Error('No video track found.')
  const limit = Number.isInteger(maxShortEdge) && Number(maxShortEdge) >= 2 ? Number(maxShortEdge) : 0
  const resize = limit > 0 && Math.min(video.width || 0, video.height || 0) > limit
  const filter = resize
    ? (Number(video.width) <= Number(video.height) ? `scale=${limit}:-2` : `scale=-2:${limit}`)
    : 'pad=ceil(iw/2)*2:ceil(ih/2)*2'
  const compatibleVideo =
    (video.codec_name === 'h264' && ['yuv420p', 'yuvj420p', 'yuv420p10le', 'yuv422p10le'].includes(video.pix_fmt || '')) ||
    (video.codec_name === 'hevc' && ['yuv420p', 'yuv420p10le'].includes(video.pix_fmt || ''))
  const copyVideo = !resize && compatibleVideo
  const audio = streams.filter((stream) => stream.codec_type === 'audio')
  const audioArgs = audio.flatMap((stream, index) =>
    ['aac', 'mp3'].includes(stream.codec_name)
      ? [`-c:a:${index}`, 'copy']
      : [`-c:a:${index}`, 'aac', `-b:a:${index}`, '256k']
  )
  const copyAudio = audio.every((stream) => ['aac', 'mp3'].includes(stream.codec_name))
  const samePath = parsed.ext.toLowerCase() === '.mp4'
  const mp4 = String(metadata.format?.format_name).split(',').includes('mp4') &&
    String(metadata.format?.tags?.major_brand || '').trim() !== 'qt'
  if (samePath && mp4 && copyVideo && copyAudio) return source
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        binary,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-nostdin',
          '-n',
          '-protocol_whitelist',
          'file,pipe',
          '-i',
          source,
          '-map',
          '0:V:0',
          '-map',
          '0:a?',
          '-map_metadata',
          '0',
          ...(copyVideo ? ['-c:v', 'copy'] : [
            '-vf', filter, '-c:v', 'libx264',
            '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p'
          ]),
          ...audioArgs,
          '-movflags',
          '+faststart',
          output
        ],
        { windowsHide: true, signal, stdio: ['ignore', 'ignore', 'pipe'] }
      )
      let error = ''
      child.stderr.on('data', (chunk: Buffer) => {
        error = (error + chunk.toString()).slice(-2000)
      })
      child.once('error', reject)
      child.once('close', (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`MP4 conversion failed. Source file was kept. ${error}`))
      )
    })
    signal.throwIfAborted()
    if ((await stat(output)).size === 0) {
      throw new Error('MP4 conversion produced an empty file.')
    }
    if (samePath) {
      await rename(output, source)
      return source
    }
    const finalPath = path.join(parsed.dir, parsed.name + '.mp4')
    await link(output, finalPath)
    await unlink(output)
    await unlink(source)
    return finalPath
  } catch (error) {
    await unlink(output).catch(() => {})
    throw error
  }
}
