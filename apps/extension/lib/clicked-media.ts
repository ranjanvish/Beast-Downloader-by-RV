import { publicUrl } from './media'

export function isMediaPage(value: unknown): value is string {
  if (!publicUrl(value)) return false
  const u = new URL(value)
  if (/(^|\.)instagram\.com$/.test(u.hostname)) return /^\/(?:p|reel|reels|tv)\/[\w-]+/.test(u.pathname)
  if (/(^|\.)youtube\.com$/.test(u.hostname)) return (u.pathname === '/watch' && u.searchParams.has('v')) || /^\/(shorts|live)\//.test(u.pathname)
  if (u.hostname === 'youtu.be') return u.pathname.length > 1
  if (/(^|\.)facebook\.com$/.test(u.hostname)) return /\/videos\/|\/reel\/|\/watch/.test(u.pathname) || u.searchParams.has('v')
  // Dedicated media paths are common across news and independent video sites.
  return /^\/(?:video|videos|watch|clip|clips|audio|podcast|episode)\/[^/]+/i.test(u.pathname)
}

/** Only use a permalink belonging to the clicked card, never another feed item. */
export function clickedMedia(element: Element) {
  const image = element instanceof HTMLImageElement
  const source = image ? element.currentSrc || element.src : (element as HTMLMediaElement).currentSrc || (element as HTMLMediaElement).src
  if (!image) {
    const wrappingLink = element.closest<HTMLAnchorElement>('a[href]')
    if (wrappingLink && publicUrl(wrappingLink.href) && new URL(wrappingLink.href).pathname !== '/') return { target: wrappingLink.href, page: location.href, variants: [] }
    let parent: Element | null = element
    for (let depth = 0; parent && depth < 7; depth++, parent = parent.parentElement) {
      if (parent.querySelectorAll('video,audio').length > 1) break
      const links = [...(parent.matches('a[href]') ? [parent] : []), ...parent.querySelectorAll('a[href]')]
      const urls = [...new Set(links.map(a => (a as HTMLAnchorElement).href).filter(isMediaPage))]
      if (urls.length === 1) return { target: urls[0], page: location.href, variants: [] }
      if (urls.length > 1) break
      const bookmark = parent.querySelector<HTMLAnchorElement>('a[rel~="bookmark"],a[itemprop="url"]')
      if (bookmark && publicUrl(bookmark.href)) return { target: bookmark.href, page: location.href, variants: [] }
    }
    const singlePlayerPage = document.querySelectorAll('video,audio').length === 1 && new URL(location.href).pathname !== '/' && Boolean(document.querySelector('meta[property="og:video"],meta[property="og:video:url"],meta[property="og:type"][content^="video"]'))
    if (isMediaPage(location.href) || singlePlayerPage) return { target: location.href, page: location.href, variants: [] }
  }
  const variants = image ? element.srcset.split(',').map(s => s.trim().split(/\s+/)).map(([url, size]) => {
    try { return { url: new URL(url, document.baseURI).href, width: size?.endsWith('w') ? Number.parseFloat(size) : element.naturalWidth * (Number.parseFloat(size) || 1) } } catch { return { url: '', width: 0 } }
  }).filter(v => publicUrl(v.url)).sort((a,b)=>b.width-a.width).slice(0,20) : []
  return { target: publicUrl(source) ? source : '', page: location.href, variants }
}

export function resolveMediaTarget(target: unknown, page: unknown, kind: string): string | undefined {
  if (publicUrl(target)) return target
  if (kind !== 'image' && isMediaPage(page)) return page
  return undefined
}
