import { parseHTML } from 'linkedom'
import { isExtensionSourceUrl } from '../../shared/extension-source-url'
import type { ImageScan, ImageSource } from '../../shared/image-download'

const IMAGE_PATH = /\.(?:png|jpe?g|webp|gif|avif|bmp|tiff?|heic|svg)(?:[?#]|$)/i
const CSS_IMAGE = /url\(\s*['"]?([^'"()]+)['"]?\s*\)/g
const GOOGLE_IMAGE = /\["(https?:[^"\n]+)"\s*,\s*(\d{2,5})\s*,\s*(\d{2,5})\s*\]/g

export function parseImagePage(html: string, pageUrl: string): ImageScan {
  const { document } = parseHTML(html)
  const images = new Map<string, ImageSource>()
  const baseHref = document.querySelector('base[href]')?.getAttribute('href')
  let baseUrl = pageUrl
  try {
    if (baseHref) {
      baseUrl = new URL(baseHref, pageUrl).href
    }
  } catch {
    /* Keep the original page URL for malformed base elements. */
  }
  const resolveUrl = (value: string | null): string | undefined => {
    try {
      const url = new URL(value || '', baseUrl).href
      return value && isExtensionSourceUrl(url) ? url : undefined
    } catch {
      return undefined
    }
  }
  const add = (source: string | null, title = '', width?: number, height?: number) => {
    const url = resolveUrl(source)
    if (!url || images.size >= 500) {
      return undefined
    }
    const image = images.get(url) || {
      url,
      title: title.slice(0, 200),
      width,
      height,
      variants: []
    }
    images.set(url, image)
    return image
  }
  // A Commons file page describes one asset; site chrome is never a gallery.
  const page = new URL(pageUrl)
  const commonsFile =
    page.hostname === 'commons.wikimedia.org' &&
    /^\/wiki\/File:/i.test(decodeURIComponent(page.pathname))
  if (commonsFile) {
    const original = resolveUrl(
      document.querySelector('.fullMedia a.internal, .fullImageLink > a')?.getAttribute('href') ||
        null
    )
    const element = document.querySelector('.fullImageLink img')
    if (!(original && element && IMAGE_PATH.test(original))) {
      throw new Error('This Wikimedia file page does not expose a downloadable image.')
    }
    const canonical = (value: string) => {
      const url = new URL(value)
      if (/(^|\.)wikimedia\.org$/.test(url.hostname)) {
        url.search = ''
      }
      return url.href
    }
    const image: ImageSource = {
      url: canonical(original),
      title: (
        document.querySelector('#firstHeading')?.textContent ||
        element.getAttribute('alt') ||
        decodeURIComponent(page.pathname.split('/').at(-1) || '')
      )
        .replace(/^File:/i, '')
        .trim(),
      width: Number(element.getAttribute('data-file-width')) || undefined,
      height: Number(element.getAttribute('data-file-height')) || undefined,
      previewUrl: resolveUrl(element.getAttribute('src')),
      variants: []
    }
    if (image.previewUrl) {
      image.previewUrl = canonical(image.previewUrl)
    }
    for (const link of document.querySelectorAll('.mw-filepage-resolutioninfo a')) {
      const href = resolveUrl(link.getAttribute('href'))
      if (!href) {
        continue
      }
      const url = canonical(href)
      if (url !== image.url && !image.variants.some((v) => v.url === url)) {
        const width =
          Number((link.textContent || '').replace(/,/g, '').match(/\d+/)?.[0]) || undefined
        image.variants.push({ url, width })
      }
    }
    return { pageUrl, images: [image] }
  }
  for (const element of document.querySelectorAll('img')) {
    const source =
      element.getAttribute('data-original') ||
      element.getAttribute('data-src') ||
      element.getAttribute('src')
    const width = Number.parseInt(element.getAttribute('width') || '', 10) || undefined
    const height = Number.parseInt(element.getAttribute('height') || '', 10) || undefined
    if (
      (width && width <= 2) ||
      (height && height <= 2) ||
      /Special:CentralAutoLogin|\/static\/images\/(?:icons|footer)|favicon/i.test(source || '')
    ) {
      continue
    }
    const image = add(source, element.getAttribute('alt') || '', width, height)
    if (!image) {
      continue
    }
    const sets = [element.getAttribute('srcset'), element.getAttribute('data-srcset')]
    if (element.parentElement?.tagName === 'PICTURE') {
      for (const sibling of element.parentElement.querySelectorAll('source')) {
        sets.push(sibling.getAttribute('srcset'))
      }
    }
    for (const set of sets) {
      for (const candidate of (set || '').split(',').slice(0, 30)) {
        const [value, size] = candidate.trim().split(/\s+/)
        const url = resolveUrl(value)
        if (!url || image.variants.some((variant) => variant.url === url)) {
          continue
        }
        const pixels = size?.endsWith('w')
          ? Number.parseFloat(size)
          : width && size?.endsWith('x')
            ? width * Number.parseFloat(size)
            : undefined
        image.variants.push({ url, width: pixels })
      }
    }
  }
  for (const meta of document.querySelectorAll(
    'meta[property="og:image"], meta[name="twitter:image"]'
  )) {
    add(meta.getAttribute('content'))
  }
  for (const link of document.querySelectorAll('a[href], link[rel="image_src"]')) {
    const href = resolveUrl(link.getAttribute('href'))
    if (!href) {
      continue
    }
    const original = new URL(href).searchParams.get('imgurl')
    if (original) {
      add(original, link.textContent || '')
    } else if (IMAGE_PATH.test(href)) {
      add(href, link.textContent || '')
    }
  }
  for (const element of document.querySelectorAll('[style]')) {
    for (const match of (element.getAttribute('style') || '').matchAll(CSS_IMAGE)) {
      add(match[1])
    }
  }
  // Google Images embeds original image URLs and dimensions in result arrays.
  const pageHost = new URL(pageUrl).hostname
  if (/(^|\.)google\.[a-z.]+$/i.test(pageHost)) {
    for (const match of html.matchAll(GOOGLE_IMAGE)) {
      try {
        add(JSON.parse(`"${match[1]}"`), '', Number(match[2]), Number(match[3]))
      } catch {
        /* Ignore incomplete result arrays. */
      }
    }
  }
  return { pageUrl, images: [...images.values()] }
}
