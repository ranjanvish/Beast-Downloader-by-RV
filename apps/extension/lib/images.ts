import { appRequest, publicUrl, type Media } from './media'
export async function scanPage(tabId: number): Promise<Media[]> {
  const results = await browser.scripting.executeScript({
    target: { tabId },
    func: () => {
      const items: {
        url: string
        kind: 'image' | 'video' | 'audio'
        width?: number
        height?: number
        title?: string
        variants?: { url: string; width?: number }[]
      }[] = []
      const add = (
        url: string,
        kind: 'image' | 'video' | 'audio',
        width?: number,
        height?: number,
        title?: string
      ) => {
        if (url && items.length < 500 && !items.some((x) => x.url === url))
          items.push({ url, kind, width, height, title })
      }
      for (const img of document.images) {
        add(img.currentSrc || img.src, 'image', img.naturalWidth, img.naturalHeight, img.alt)
        const variants = img.srcset
          .split(',')
          .map((x) => x.trim().split(/\s+/))
          .filter((x) => x[0])
          .sort((a, b) => parseFloat(b[1] || '0') - parseFloat(a[1] || '0'))
        const item = items.find(i=>i.url===(img.currentSrc || img.src))
        if (item) item.variants = variants.slice(0,20).flatMap(([source,size])=>{
          try { return [{ url: new URL(source, document.baseURI).href, width: size?.endsWith('w') ? Number.parseFloat(size) : img.naturalWidth * (Number.parseFloat(size) || 1) }] } catch { return [] }
        })
      }
      for (const el of document.querySelectorAll<HTMLMediaElement>('video,audio')) {
        const kind = el.tagName === 'AUDIO' ? 'audio' : 'video'
        add(el.currentSrc || el.src, kind)
        for (const source of el.querySelectorAll('source')) add(source.src, kind)
      }
      for (const resource of performance.getEntriesByType('resource'))
        if (/\.(mp4|webm|m3u8|mpd|mp3|m4a|ogg)(?:\?|$)/i.test(resource.name))
          add(resource.name, /\.(mp3|m4a|ogg)(?:\?|$)/i.test(resource.name) ? 'audio' : 'video')
      let count = 0
      for (const el of document.querySelectorAll('body *')) {
        if (++count > 2000 || items.length >= 500) break
        const bg = getComputedStyle(el).backgroundImage
        const match = /^url\(["']?(.*?)["']?\)$/.exec(bg)
        if (match)
          try {
            add(new URL(match[1], document.baseURI).href, 'image')
          } catch {
            /* Invalid CSS URL. */
          }
      }
      return items
    }
  })
  return (results[0]?.result || []).filter((m) => publicUrl(m.url))
}

export async function imageBlob(url: string, output: string): Promise<Blob> {
  if (!publicUrl(url)) throw new Error('Invalid image URL.')
  const res = await fetch(url, {
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(20000)
  })
  if (!res.ok) throw new Error('Image server refused the request.')
  const type = (res.headers.get('content-type') || '').split(';')[0]
  if (!(type.startsWith('image/') || type === 'application/octet-stream')) throw new Error('The server returned a page instead of an image.')
  const reader = res.body?.getReader()
  if (!reader) throw new Error('Empty image.')
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > 20 * 1024 * 1024) throw new Error('Image exceeds the 20 MB limit.')
      chunks.push(new Uint8Array(value))
    }
  } finally {
    await reader.cancel()
  }
  const original = new Blob(chunks, { type })
  if (output === 'original') return original
  let bitmap: ImageBitmap
  try {
    if (type === 'image/svg+xml') {
      const text = await original.text()
      if (/<!|<script|<foreignObject|\bhref\s*=|url\s*\(|@import|<\?xml-stylesheet/i.test(text)) throw new Error('SVG has external or active content. Save the original instead.')
      const image = new Image()
      const objectUrl = URL.createObjectURL(original)
      try { await new Promise<void>((resolve,reject)=>{ image.onload=()=>resolve(); image.onerror=()=>reject(new Error('SVG could not be decoded.')); image.src=objectUrl }); bitmap = await createImageBitmap(image) }
      finally { URL.revokeObjectURL(objectUrl) }
    } else bitmap = await createImageBitmap(original)
  } catch (error) {
    if (type === 'image/svg+xml') throw error
    let binary = ''
    const bytes = new Uint8Array(await original.arrayBuffer())
    for (let i=0; i<bytes.length; i+=32768) binary += String.fromCharCode(...bytes.subarray(i,i+32768))
    const converted = await appRequest('/beast/image', { data: btoa(binary), output }) as unknown as {data:string; mime:string}
    if (!converted.data || converted.mime !== 'image/'+output) throw new Error('Desktop image converter returned an invalid result.')
    return new Blob([Uint8Array.from(atob(converted.data),c=>c.charCodeAt(0))], {type:converted.mime})
  }
  try {
    if (bitmap.width * bitmap.height > 32_000_000)
      throw new Error('Image exceeds the 32 megapixel conversion limit.')
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Image conversion unavailable.')
    if (output === 'jpeg') {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    ctx.drawImage(bitmap, 0, 0)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Conversion failed.'))),
        'image/' + output,
        0.94
      )
    )
  } finally {
    bitmap.close()
  }
}
export const safeName = (value: string) =>
  value
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 80) || 'image'
export async function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  try {
    const id = await browser.downloads.download({
      url,
      filename,
      conflictAction: 'uniquify',
      saveAs: false
    })
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: string) => {
        clearTimeout(timer)
        browser.downloads.onChanged.removeListener(changed)
        if (error)
          reject(
            new Error(
              'Browser download failed: ' + error + '. Check the download folder and retry.'
            )
          )
        else resolve()
      }
      const changed = (event: {
        id: number
        state?: { current?: string }
        error?: { current?: string }
      }) => {
        if (event.id !== id) return
        if (event.state?.current === 'complete') finish()
        if (event.error?.current || event.state?.current === 'interrupted')
          finish(event.error?.current || 'interrupted')
      }
      const timer = setTimeout(() => finish('timed out'), 60000)
      browser.downloads.onChanged.addListener(changed)
      void browser.downloads
        .search({ id })
        .then((items) => {
          if (items[0]?.state === 'complete') finish()
          else if (items[0]?.state === 'interrupted') finish(items[0].error || 'interrupted')
        })
        .catch(() => finish('status unavailable'))
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}
/** Store-only ZIP: bounded input, no compression worker or third-party executable. */
export async function makeZip(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const local: Uint8Array<ArrayBuffer>[] = []
  const central: Uint8Array<ArrayBuffer>[] = []
  let offset = 0,
    centralSize = 0
  const encoder = new TextEncoder()
  for (const file of files) {
    const data = new Uint8Array(await file.blob.arrayBuffer()),
      name = encoder.encode(file.name)
    let crc = 0xffffffff
    for (const byte of data) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
    crc = (crc ^ 0xffffffff) >>> 0
    const head = new Uint8Array(30 + name.length),
      view = new DataView(head.buffer)
    view.setUint32(0, 0x04034b50, true)
    view.setUint16(4, 20, true)
    view.setUint32(14, crc, true)
    view.setUint32(18, data.length, true)
    view.setUint32(22, data.length, true)
    view.setUint16(26, name.length, true)
    head.set(name, 30)
    const entry = new Uint8Array(46 + name.length),
      cv = new DataView(entry.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    entry.set(name, 46)
    local.push(head, data)
    central.push(entry)
    offset += head.length + data.length
    centralSize += entry.length
  }
  const end = new Uint8Array(22),
    ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)
  return new Blob([...local, ...central, end], { type: 'application/zip' })
}
