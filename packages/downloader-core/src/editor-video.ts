import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { stat, unlink } from 'node:fs/promises'
import path from 'node:path'

/** Create an actual H.264/AAC MP4, including when the source already ends in .mp4. */
export async function createEditorVideo(
  source: string,
  ffmpegDirectory: string,
  signal: AbortSignal
): Promise<string> {
  const parsed = path.parse(source)
  const output = path.join(parsed.dir, `${parsed.name}.editor-${randomUUID().slice(0, 8)}.mp4`)
  const binary = path.join(ffmpegDirectory, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
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
          '0:v:0',
          '-map',
          '0:a:0?',
          '-map_metadata',
          '0',
          '-vf',
          'pad=ceil(iw/2)*2:ceil(ih/2)*2,fps=30',
          '-c:v',
          'libx264',
          '-preset',
          'fast',
          '-crf',
          '18',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-ar',
          '48000',
          '-ac',
          '2',
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
    return output
  } catch (error) {
    await unlink(output).catch(() => {})
    throw error
  }
}
