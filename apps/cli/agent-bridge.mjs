import { readFile, stat, writeFile, link, unlink } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const terminal = new Set(['completed', 'failed', 'cancelled'])

export function descriptorPath(env = process.env, platform = process.platform) {
  if (env.VIDBEE_AUTOMATION_DESCRIPTOR) return env.VIDBEE_AUTOMATION_DESCRIPTOR
  const root = platform === 'win32' ? env.APPDATA : platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : (env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'))
  return path.join(root || path.join(os.homedir(), 'AppData', 'Roaming'), 'VidBee', 'automation.json')
}

export class BeastBridge {
  constructor(baseUrl, fetchImpl = fetch) {
    const parsed = new URL(baseUrl)
    if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || parsed.username || parsed.password) throw new Error('Desktop bridge must use 127.0.0.1 over HTTP')
    this.baseUrl = parsed.origin
    this.fetchImpl = fetchImpl
    this.token = undefined
  }
  async request(endpoint, body, allowRenew = true) {
    if (!this.token && endpoint !== 'handshake') await this.handshake()
    const response = await this.fetchImpl(`${this.baseUrl}/automation/v1/${endpoint}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(this.token && endpoint !== 'handshake' ? { authorization: `Bearer ${this.token}` } : {}) },
      body: JSON.stringify(body), signal: AbortSignal.timeout(30000)
    })
    if (response.status === 401 && allowRenew && endpoint !== 'handshake') {
      await this.handshake()
      return this.request(endpoint, body, false)
    }
    const result = await response.json()
    if (!response.ok) throw new Error(`Beast ${endpoint}: ${result.error || response.status}`)
    return result
  }
  async handshake() {
    const result = await this.request('handshake', {}, false)
    if (typeof result.token !== 'string' || !result.token) throw new Error('Beast handshake returned no token')
    this.token = result.token
  }
  async snapshotAll() {
    const rows = []
    let pages = 1
    for (let page = 0; page < pages; page++) {
      const data = await this.request('batch/snapshot', { page })
      if (!Array.isArray(data.items) || !Number.isInteger(data.pages)) throw new Error('Invalid Beast snapshot')
      rows.push(...data.items)
      pages = data.pages
    }
    return rows
  }
  async add(url) {
    const parsed = new URL(url)
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Expected an HTTP(S) media URL without credentials')
    const result = await this.request('batch/add', { text: url })
    if (result.added !== 1 || result.ids?.length !== 1) throw new Error(`Link was not added: ${result.duplicates ? 'already in queue; inspect existing row' : JSON.stringify(result.invalid)}`)
    return result.ids[0]
  }
  async waitFor(id, target, timeoutMs = 120000, intervalMs = 1000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const row = (await this.snapshotAll()).find((item) => item.id === id)
      if (!row) throw new Error(`Queue item ${id} disappeared`)
      if (target.has(row.status) || terminal.has(row.status)) return row
      await sleep(intervalMs)
    }
    throw new Error(`Timed out waiting for ${id}; inspect its queue state before retrying`)
  }
  async fetchItem(id) {
    await this.request('batch/fetch', { ids: [id] })
    const row = await this.waitFor(id, new Set(['ready']))
    if (row.status !== 'ready') throw new Error(`Fetch failed: ${row.error || row.status}`)
    return row
  }
  async configure(id, patch) { return this.request('batch/patch', { id, patch }) }
  async start(id) { return this.request('batch/start', { ids: [id] }) }
}

export async function connectDesktop(file = descriptorPath()) {
  let data
  try { data = JSON.parse(await readFile(file, 'utf8')) } catch { throw new Error(`Beast desktop is not ready: automation descriptor unavailable at ${file}`) }
  if (data.version !== 1 || data.host !== '127.0.0.1' || !Number.isInteger(data.port) || data.port < 1 || data.port > 65535 || !Number.isInteger(data.pid)) throw new Error('Invalid Beast desktop descriptor')
  try { process.kill(data.pid, 0) } catch { throw new Error('Cannot verify the Beast desktop process. It may have stopped, or this agent may be isolated by a sandbox; check Beast and run the agent with access to the desktop session.') }
  const bridge = new BeastBridge(`http://127.0.0.1:${data.port}`)
  await bridge.handshake()
  return bridge
}

export async function verifyMedia(filePath, output, expectedDuration, expectAudio = false) {
  const info = await stat(filePath)
  if (!info.isFile() || info.size === 0) throw new Error('Downloaded file is empty or missing')
  const media = await new Promise((resolve, reject) => {
    const bundledProbe = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'ffmpeg', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
    const proc = spawn(existsSync(bundledProbe) ? bundledProbe : 'ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', filePath], { windowsHide: true })
    let stdout = '', stderr = ''
    proc.stdout.on('data', (chunk) => { stdout += chunk })
    proc.stderr.on('data', (chunk) => { stderr += chunk })
    proc.on('error', reject)
    proc.on('close', (code) => { if (code !== 0) reject(new Error(`ffprobe failed: ${stderr.slice(0, 300)}`)); else { try { resolve(JSON.parse(stdout)) } catch { reject(new Error('Invalid ffprobe output')) } } })
  })
  const stream = media.streams?.find((s) => s.codec_type === (output === 'audio' ? 'audio' : 'video'))
  if (!stream) throw new Error(`Downloaded file has no ${output === 'audio' ? 'audio' : 'video'} stream`)
  if (expectAudio && !media.streams?.some((s) => s.codec_type === 'audio')) throw new Error('Downloaded video has no expected audio stream')
  const duration = Number(media.format?.duration)
  if (expectedDuration !== undefined && (!Number.isFinite(duration) || Math.abs(duration - expectedDuration) > Math.max(2, expectedDuration * 0.1))) throw new Error(`Unexpected clip duration: ${duration} seconds`)
  return { bytes: info.size, duration: Number.isFinite(duration) ? duration : null, width: stream.width || null, height: stream.height || null }
}

export async function saveManifest(file, record) {
  const target = path.resolve(file)
  const temporary = `${target}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
  try { await link(temporary, target) } finally { await unlink(temporary) }
}

export async function downloadOne(bridge, input) {
  if (!input.folder || !path.isAbsolute(input.folder)) throw new Error('An absolute destination folder is required')
  if (!['image', 'video', 'audio'].includes(input.output)) throw new Error('Output must be image, video or audio')
  if ((input.start === undefined) !== (input.end === undefined)) throw new Error('Supply both start and end for a clip')
  if (input.start !== undefined && (!Number.isFinite(input.start) || !Number.isFinite(input.end) || input.start < 0 || input.end <= input.start || input.output === 'image')) throw new Error('Invalid clip range')
  const id = await bridge.add(input.url)
  const initial = await bridge.fetchItem(id)
  if ((initial.kind === 'image') !== (input.output === 'image')) throw new Error(`Detected ${initial.kind}; cannot use requested ${input.output} output. Review queue item ${id}.`)
  const patch = { output: input.output, folder: input.folder }
  if (input.start !== undefined) { patch.start = String(input.start); patch.end = String(input.end) }
  if (input.output === 'video') {
    patch.container = 'mp4'
  }
  await bridge.configure(id, patch)
  await bridge.start(id)
  const row = await bridge.waitFor(id, new Set(), input.timeoutMs || 600000)
  if (row.status !== 'completed' || !row.filePath) throw new Error(`Download ${id} ${row.status}: ${row.error || 'no output file'}`)
  const expectAudio = input.output === 'video' && Boolean(initial.options?.audioTrack)
  const verified = await verifyMedia(row.filePath, input.output, input.start === undefined ? undefined : input.end - input.start, expectAudio)
  return { schema: 1, sourceUrl: input.url, publisher: input.publisher || null, rights: input.rights || 'unconfirmed', sourceIn: input.start ?? null, sourceOut: input.end ?? null, output: input.output, queueId: id, title: row.title, filePath: row.filePath, verification: verified }
}
