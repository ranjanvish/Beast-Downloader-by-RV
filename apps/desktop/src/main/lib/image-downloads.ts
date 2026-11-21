import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { mkdir, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import path from 'node:path'
import { app, BrowserWindow, nativeImage } from 'electron'
import { isExtensionSourceUrl } from '../../shared/extension-source-url'
import type {
  ImageOutput,
  ImageSaveResult,
  ImageScan,
  ImageSource
} from '../../shared/image-download'
import { settingsManager } from '../settings'
import { convertBeastImage } from './beast-image-converter'
import { recordSavedImage } from './download-library-store'
import { parseImagePage } from './image-page-parser'

const MAX_BYTES = 20 * 1024 * 1024
// biome-ignore lint/suspicious/noControlCharactersInRegex: Reject control characters in Windows filenames.
const UNSAFE_FILENAME = /[<>:"/\\|?*\x00-\x1f]/g
let imported: ImageScan | null = null
let saving = false

export async function readPublicImageResource(
  value: string,
  referer?: string,
  maxBytes = MAX_BYTES
) {
  let current = value
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (!isExtensionSourceUrl(current)) {
      throw new Error('Enter a public HTTP or HTTPS image or webpage URL.')
    }
    const url = new URL(current)
    const addresses = await lookup(url.hostname, { all: true })
    if (
      !addresses.length ||
      addresses.some(({ address, family }) => {
        if (family === 6) {
          return !/^[23][0-9a-f]{3}:/i.test(address)
        }
        const [a, b, c] = address.split('.').map(Number)
        return (
          a === 0 ||
          a === 10 ||
          a === 127 ||
          a >= 224 ||
          (a === 169 && b === 254) ||
          (a === 172 && b >= 16 && b <= 31) ||
          (a === 192 && (b === 168 || b === 0)) ||
          (a === 100 && b >= 64 && b <= 127) ||
          (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
          (a === 203 && b === 0 && c === 113)
        )
      })
    ) {
      throw new Error('Private and local network image addresses are not supported.')
    }
    const address = addresses.find((record) => record.family === 4) || addresses[0]
    const result = await new Promise<{
      status: number
      location?: string
      mime: string
      bytes: Buffer
    }>((resolve, reject) => {
      const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
        url,
        {
          signal: AbortSignal.timeout(30_000),
          family: address.family,
          lookup: (_host, _options, callback) => callback(null, address.address, address.family),
          headers: {
            'User-Agent': 'Mozilla/5.0 BeastDownloader',
            Accept: 'image/*,text/html;q=0.8,*/*;q=0.5',
            ...(referer && isExtensionSourceUrl(referer)
              ? { Referer: `${new URL(referer).origin}/` }
              : {})
          }
        },
        (response) => {
          const status = response.statusCode || 0
          const mime = String(response.headers['content-type'] || '')
            .split(';')[0]
            .toLowerCase()
          if (status >= 300 && status < 400 && response.headers.location) {
            response.resume()
            resolve({ status, location: response.headers.location, mime, bytes: Buffer.alloc(0) })
            return
          }
          if (status !== 200) {
            response.resume()
            reject(
              new Error(
                `The image server returned HTTP ${status}. Try the extension on the open page.`
              )
            )
            return
          }
          const chunks: Buffer[] = []
          let size = 0
          response.on('data', (chunk: Buffer) => {
            size += chunk.length
            if (size > maxBytes) {
              request.destroy(new Error('This image or page exceeds the 20 MB limit.'))
              return
            }
            chunks.push(chunk)
          })
          response.on('error', reject)
          response.on('end', () => resolve({ status, mime, bytes: Buffer.concat(chunks) }))
        }
      )
      request.on('error', reject)
      request.end()
    })
    if (result.location) {
      current = new URL(result.location, current).href
      continue
    }
    return { ...result, url: current }
  }
  throw new Error('The image server redirected too many times.')
}

export function imageFileType(bytes: Buffer): string | undefined {
  const head = bytes.subarray(0, 32)
  if (head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return 'png'
  }
  if (head[0] === 255 && head[1] === 216 && head[2] === 255) {
    return 'jpg'
  }
  if (/^GIF8[79]a/.test(head.toString('ascii'))) {
    return 'gif'
  }
  if (head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP') {
    return 'webp'
  }
  if (head.toString('ascii', 4, 8) === 'ftyp') {
    const brands = head.toString('ascii', 8)
    if (/avif|avis/.test(brands)) {
      return 'avif'
    }
    if (/heic|heix|hevc|mif1/.test(brands)) {
      return 'heic'
    }
  }
  if (head.toString('ascii', 0, 2) === 'BM') {
    return 'bmp'
  }
  if (head.toString('hex', 0, 4) === '00000100') {
    return 'ico'
  }
  if (head.toString('hex', 0, 4) === '49492a00' || head.toString('hex', 0, 4) === '4d4d002a') {
    return 'tiff'
  }
  if (/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(bytes.subarray(0, 1024).toString('utf8'))) {
    return 'svg'
  }
  return undefined
}

async function decodeImage(bytes: Buffer, type: string) {
  let image = nativeImage.createFromBuffer(bytes)
  if (image.isEmpty() && type !== 'svg' && bytes.length <= 20 * 1024 * 1024) {
    try {
      const converted = await convertBeastImage({ data: bytes.toString('base64'), output: 'png' })
      image = nativeImage.createFromBuffer(Buffer.from(converted.data, 'base64'))
    } catch {
      // Unavailable previews must not prevent saving the original image.
    }
  }
  return image
}

export async function scanImages(url: string): Promise<ImageScan> {
  const response = await readPublicImageResource(url)
  const type = imageFileType(response.bytes)
  if (type) {
    const image = await decodeImage(response.bytes, type)
    const size = image.isEmpty() ? {} : image.getSize()
    return {
      pageUrl: response.url,
      images: [
        {
          url: response.url,
          title: path.basename(new URL(response.url).pathname),
          ...size,
          variants: []
        }
      ]
    }
  }
  if (!['text/html', 'application/xhtml+xml'].includes(response.mime)) {
    throw new Error('This URL did not return an image or a webpage.')
  }
  if (response.bytes.length > 5 * 1024 * 1024) {
    throw new Error(
      'The webpage is too large to scan. Use the browser extension to send selected images.'
    )
  }
  return parseImagePage(response.bytes.toString('utf8'), response.url)
}

export function importBrowserImages(body: Record<string, unknown>): number {
  const images: ImageSource[] = []
  if (!Array.isArray(body.images) || body.images.length > 100) {
    throw new Error('Send between 1 and 100 selected images.')
  }
  for (const source of body.images) {
    if (
      !source ||
      typeof source.url !== 'string' ||
      !isExtensionSourceUrl(source.url) ||
      images.some((image) => image.url === source.url)
    ) {
      continue
    }
    const variants: ImageSource['variants'] = []
    for (const variant of Array.isArray(source.variants) ? source.variants.slice(0, 20) : []) {
      if (variant && typeof variant.url === 'string' && isExtensionSourceUrl(variant.url)) {
        variants.push({ url: variant.url, width: Number(variant.width) || undefined })
      }
    }
    images.push({
      url: source.url,
      title: String(source.title || '').slice(0, 200),
      previewUrl:
        typeof source.previewUrl === 'string' && isExtensionSourceUrl(source.previewUrl)
          ? source.previewUrl
          : undefined,
      width: Number(source.width) || undefined,
      height: Number(source.height) || undefined,
      variants
    })
  }
  if (!images.length) {
    throw new Error('No public image URLs were included.')
  }
  imported = {
    pageUrl:
      typeof body.pageUrl === 'string' && isExtensionSourceUrl(body.pageUrl)
        ? body.pageUrl
        : images[0].url,
    images
  }
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('beast:images-imported')
  }
  return images.length
}

export function consumeImportedImages(): ImageScan | null {
  const result = imported
  imported = null
  return result
}

export async function previewImage(url: string): Promise<string | null> {
  const { bytes } = await readPublicImageResource(url, undefined, 4 * 1024 * 1024)
  const type = imageFileType(bytes)
  if (!type || type === 'svg') {
    return null
  }
  const image = await decodeImage(bytes, type)
  if (image.isEmpty()) {
    return null
  }
  const size = image.getSize()
  if (size.width * size.height > 32_000_000) {
    return null
  }
  return image.resize({ width: Math.min(280, size.width) }).toDataURL()
}

export async function saveImages(options: {
  images: { url: string; title?: string }[]
  pageUrl?: string
  output: ImageOutput
  directory?: string
}): Promise<ImageSaveResult> {
  if (saving) {
    throw new Error('Another image batch is still downloading.')
  }
  if (!(Array.isArray(options.images) && options.images.length) || options.images.length > 100) {
    throw new Error('Choose between 1 and 100 images.')
  }
  if (
    options.images.some(
      (image) =>
        !image ||
        typeof image.url !== 'string' ||
        (image.title !== undefined && typeof image.title !== 'string')
    )
  ) {
    throw new Error('Each selected image needs a valid URL and title.')
  }
  if (!['original', 'png', 'jpeg', 'webp'].includes(options.output)) {
    throw new Error('Choose a supported image output format.')
  }
  const directory =
    options.directory?.trim() || settingsManager.getAll().downloadPath || app.getPath('downloads')
  if (!path.isAbsolute(directory)) {
    throw new Error('Choose an absolute download folder.')
  }
  const result: ImageSaveResult = { saved: [], failed: [], directory }
  saving = true
  try {
    await mkdir(directory, { recursive: true })
    for (const image of options.images) {
      try {
        const response = await readPublicImageResource(image.url, options.pageUrl)
        const sourceType = imageFileType(response.bytes)
        if (!sourceType) {
          throw new Error('The server returned a page or an unsupported file instead of an image.')
        }
        if (
          sourceType === 'svg' &&
          options.output !== 'original' &&
          /<!|<script|<foreignObject|\bhref\s*=|url\s*\(|@import/i.test(
            response.bytes.toString('utf8')
          )
        ) {
          throw new Error(
            'This SVG contains external or active content. Save it as Original instead.'
          )
        }
        const ext =
          options.output === 'original'
            ? sourceType
            : options.output === 'jpeg'
              ? 'jpg'
              : options.output
        const bytes =
          options.output === 'original'
            ? response.bytes
            : Buffer.from(
                (
                  await convertBeastImage({
                    data: response.bytes.toString('base64'),
                    output: options.output
                  })
                ).data,
                'base64'
              )
        const identifier = createHash('sha256').update(image.url).digest('hex').slice(0, 10)
        const name =
          (image.title || path.basename(new URL(image.url).pathname) || 'image')
            .replace(/\.[a-zA-Z0-9]{2,5}$/, '')
            .replace(UNSAFE_FILENAME, '_')
            .replace(/[ .]+$/, '')
            .slice(0, 80) || 'image'
        let savedPath = ''
        for (let suffix = 0; suffix < 1000; suffix++) {
          const target = path.join(
            directory,
            `${identifier}-${name}${suffix ? `-${suffix}` : ''}.${ext}`
          )
          try {
            await writeFile(target, bytes, { flag: 'wx' })
            savedPath = target
            break
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
              throw error
            }
          }
        }
        if (!savedPath) {
          throw new Error('Too many files with the same name already exist.')
        }
        result.saved.push({ url: image.url, path: savedPath })
        recordSavedImage(image.url, savedPath, image.title || name)
      } catch (error) {
        result.failed.push({
          url: image.url,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
  } finally {
    saving = false
  }
  return result
}
