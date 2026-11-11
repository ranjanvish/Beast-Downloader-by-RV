export interface Format {
  format_id: string
  ext: string
  height?: number
  fps?: number
  vcodec?: string
  acodec?: string
  language?: string
  format_note?: string
  tbr?: number
  protocol?: string
  filesize?: number
}
export interface Info {
  ticket: string
  title: string
  duration?: number
  formats: Format[]
}
export interface Media {
  url: string
  kind: 'video' | 'audio' | 'image'
  width?: number
  height?: number
  title?: string
  variants?: { url: string; width?: number }[]
}
export function publicUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false
  try {
    const u = new URL(value)
    return (
      ['http:', 'https:'].includes(u.protocol) &&
      !u.username &&
      !u.password &&
      u.hostname.includes('.') &&
      !u.hostname.includes(':') &&
      !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
        u.hostname
      ) &&
      !u.hostname.endsWith('.localhost')
    )
  } catch {
    return false
  }
}
let appBase: string | undefined
export async function appHealth() {
  const ports = appBase ? [Number(new URL(appBase).port), ...Array.from({length:21},(_,n)=>27100+n).filter(p=>p!==Number(new URL(appBase!).port))] : Array.from({length:21},(_,n)=>27100+n)
  const found = await Promise.all(
    ports.map(async (port) => {
      const base = `http://127.0.0.1:${port}`
      try {
        const response = await fetch(base + '/status', {
          headers: { 'X-VidBee-Extension': location.origin },
          signal: AbortSignal.timeout(2500)
        })
        const data = await response.json()
        return response.ok && data.capabilities?.extensionSecurity ? { base, ...data } : null
      } catch {
        return null
      }
    })
  )
  const status = found.find(Boolean)
  if (!status) throw new Error('Cannot connect to Beast. Open the desktop app and retry. If the browser asks for local-network access, allow it. If already open, restart Beast and reload this extension.')
  appBase = status.base
  return status as { base: string; appVersion?: string; companionVersion?: string; companionReady?: boolean }
}
export async function appRequest(path: string, body: object, stage?: (message:string)=>void): Promise<Info & { queued?: boolean }> {
  stage?.('Connecting to Beast Downloader…')
  const {base} = await appHealth()
  stage?.('Connected. Checking secure access…')
  const handshake = await fetch(base + '/token', {
    method: 'POST',
    headers: { 'X-VidBee-Extension': location.origin },
    signal: AbortSignal.timeout(3000)
  })
  const token = await handshake.json()
  if (!handshake.ok || !token.token)
    throw new Error(
      'Connection refused. Reinstall the bundled Beast extension from the desktop Extensions page.'
    )
  stage?.(path === '/beast/info' ? 'Fetching media information, qualities and audio languages…' : 'Sending request to Beast…')
  const res = await fetch(base + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token.token}`,
      'X-VidBee-Extension': location.origin
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(100000)
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Request failed. Try again.')
  return data
}
export function language(format: Format): string {
  let label = format.language || 'Source audio'
  try {
    if (format.language)
      label = new Intl.DisplayNames(['en'], { type: 'language' }).of(format.language) || label
  } catch {
    /* Preserve source labels. */
  }
  return `${label}${/original/i.test(format.format_note || '') ? ' · Original' : ''} · ${Math.round(format.tbr || 0) || 'Auto'} kbps · ${format.ext}`
}
