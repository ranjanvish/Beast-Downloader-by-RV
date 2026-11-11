import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'

const execute = promisify(execFile)

export async function convertBeastImage(body: Record<string, unknown>) {
  if (
    !['png', 'jpeg', 'webp'].includes(String(body.output)) ||
    typeof body.data !== 'string' ||
    body.data.length > 28_000_000 ||
    !/^[a-zA-Z0-9+/]*={0,2}$/.test(body.data)
  ) {
    throw new Error('Invalid image conversion request.')
  }
  const directory = app.isPackaged
    ? path.join(process.resourcesPath, 'resources', 'imagemagick')
    : path.join(app.getAppPath(), 'resources', 'imagemagick')
  const temporary = await mkdtemp(path.join(app.getPath('temp'), 'beast-image-'))
  try {
    const input = path.join(temporary, 'source.bin')
    const output = path.join(temporary, `converted.${body.output}`)
    await writeFile(input, Buffer.from(body.data, 'base64'))
    await execute(
      path.join(directory, 'magick.exe'),
      [
        `${input}[0]`,
        '-auto-orient',
        '-colorspace',
        'sRGB',
        '-depth',
        '8',
        '-strip',
        ...(body.output === 'jpeg'
          ? [
              '-background',
              'white',
              '-alpha',
              'remove',
              '-alpha',
              'off',
              '-sampling-factor',
              '4:4:4',
              '-quality',
              '96'
            ]
          : ['-define', 'png:color-type=6']),
        output
      ],
      {
        windowsHide: true,
        timeout: 50_000,
        maxBuffer: 4096,
        cwd: directory,
        env: { ...process.env, MAGICK_CONFIGURE_PATH: directory, MAGICK_TEMPORARY_PATH: temporary }
      }
    )
    if ((await stat(output)).size > 64 * 1024 * 1024) {
      throw new Error('Converted image exceeds 64 MB.')
    }
    return { data: (await readFile(output)).toString('base64'), mime: `image/${body.output}` }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}
