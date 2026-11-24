#!/usr/bin/env node
import readline from 'node:readline'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { connectDesktop, downloadOne, verifyMedia } from './agent-bridge.mjs'

const item = { type: 'string', minLength: 1, maxLength: 1000 }
const ids = { type: 'array', minItems: 1, maxItems: 100, items: item }
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
const definitions = [
  { name: 'beast_status', description: 'Read all Beast workspace items, status, selected formats and paths.', inputSchema: object({}) },
  { name: 'beast_start_desktop', description: 'Start the installed Beast desktop app if it is not responding; return a clear error if it does not become ready.', inputSchema: object({}) },
  { name: 'beast_add', description: 'Add HTTP(S) media URLs to the Beast queue. Existing URLs are deduplicated.', inputSchema: object({ urls: { type: 'array', minItems: 1, maxItems: 100, items: item } }, ['urls']) },
  { name: 'beast_fetch', description: 'Fetch metadata for explicit queue IDs. May discover multiple images.', inputSchema: object({ ids }, ['ids']) },
  { name: 'beast_configure', description: 'Configure one fetched item with Beast settings: output, videoFormat, audioTrack, audioOutput, audioBitrate, imageOutput, imageUrl, container, folder, start and end.', inputSchema: object({ id: item, patch: { type: 'object' } }, ['id', 'patch']) },
  { name: 'beast_configure_many', description: 'Apply the same explicit item settings to each specified ID. Reports per-item errors; does not change other queue rows.', inputSchema: object({ ids, patch: { type: 'object' } }, ['ids', 'patch']) },
  { name: 'beast_start', description: 'Start explicit ready IDs using the Beast desktop queue.', inputSchema: object({ ids }, ['ids']) },
  { name: 'beast_cancel', description: 'Cancel explicit job IDs. This does not delete completed files.', inputSchema: object({ ids }, ['ids']) },
  { name: 'beast_preview', description: 'Get the Beast desktop preview descriptor for an item. batch-media:// URLs are playable inside Beast, not a standalone URL.', inputSchema: object({ id: item, refresh: { type: 'boolean' } }, ['id']) },
  { name: 'beast_download_one', description: 'Fetch and download one URL, optionally an exact source range; verify the output. Rights status is supplied by the caller and not checked.', inputSchema: object({ url: item, output: { enum: ['image', 'video', 'audio'] }, folder: item, start: { type: 'number', minimum: 0 }, end: { type: 'number', minimum: 0 }, publisher: item, rights: item }, ['url', 'output', 'folder']) },
  { name: 'beast_verify_file', description: 'Inspect local image/audio/video streams using ffprobe, optionally check duration.', inputSchema: object({ filePath: item, output: { enum: ['image', 'video', 'audio'] }, expectedDuration: { type: 'number', minimum: 0 }, expectAudio: { type: 'boolean' } }, ['filePath', 'output']) },
  { name: 'beast_prepare_premiere', description: 'Verify a local video and prepare a handoff request for RAVIX Studio. Does not import or change a Premiere timeline.', inputSchema: object({ filePath: item, sequenceId: item, trackIndex: { type: 'integer', minimum: 0 }, destinationSeconds: { type: 'number', minimum: 0 }, sourceIn: { type: 'number', minimum: 0 }, sourceOut: { type: 'number', minimum: 0 } }, ['filePath', 'sequenceId', 'trackIndex', 'destinationSeconds', 'sourceIn', 'sourceOut']) }
]
const ops = new Map([['beast_fetch', 'fetch'], ['beast_configure', 'patch'], ['beast_start', 'start'], ['beast_cancel', 'cancel'], ['beast_preview', 'preview']])
const optionNames = new Set(['kind', 'output', 'videoFormat', 'audioTrack', 'audioOutput', 'audioBitrate', 'imageOutput', 'imageUrl', 'container', 'folder', 'start', 'end'])

function validate(name, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Arguments must be an object')
  const definition = definitions.find((value) => value.name === name)
  if (!definition) throw new Error(`Unknown tool ${name}`)
  const schema = definition.inputSchema
  for (const key of Object.keys(args)) if (!(key in schema.properties)) throw new Error(`Unknown argument ${key}`)
  for (const key of schema.required) if (!(key in args)) throw new Error(`Missing argument ${key}`)
  for (const [key, value] of Object.entries(args)) {
    const spec = schema.properties[key]
    if (spec.type === 'string' && (typeof value !== 'string' || !value.length || value.length > 1000)) throw new Error(`Invalid ${key}`)
    if (spec.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new Error(`Invalid ${key}`)
    if (spec.type === 'integer' && (!Number.isInteger(value) || value < 0)) throw new Error(`Invalid ${key}`)
    if (spec.type === 'boolean' && typeof value !== 'boolean') throw new Error(`Invalid ${key}`)
    if (spec.type === 'array' && (!Array.isArray(value) || !value.length || value.length > 100 || value.some((entry) => typeof entry !== 'string' || !entry.length || entry.length > 1000))) throw new Error(`Invalid ${key}`)
    if (spec.type === 'object' && (!value || typeof value !== 'object' || Array.isArray(value))) throw new Error(`Invalid ${key}`)
    if (spec.enum && !spec.enum.includes(value)) throw new Error(`Invalid ${key}`)
  }
  if (['beast_configure', 'beast_configure_many'].includes(name) && Object.keys(args.patch).some((key) => !optionNames.has(key))) throw new Error('Unsupported item setting')
  if (name === 'beast_add') for (const url of args.urls) { const u = new URL(url); if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) throw new Error('Only HTTP(S) URLs without credentials are allowed') }
}

export async function callTool(name, args, connect = connectDesktop) {
  validate(name, args)
  if (name === 'beast_verify_file') return verifyMedia(args.filePath, args.output, args.expectedDuration, args.expectAudio)
  if (name === 'beast_prepare_premiere') {
    if (args.sourceOut <= args.sourceIn) throw new Error('sourceOut must be after sourceIn')
    const verified = await verifyMedia(args.filePath, 'video')
    if (verified.duration === null || args.sourceOut > verified.duration + 0.04) throw new Error('Source range exceeds verified media duration')
    return { stage: 'handoff_prepared', filePath: args.filePath, verified, target: { sequenceId: args.sequenceId, videoTrackIndex: args.trackIndex, startSeconds: args.destinationSeconds }, source: { inSeconds: args.sourceIn, outSeconds: args.sourceOut }, next: 'Use RAVIX Studio Premiere tools to inspect sequence, import the media, verify track occupancy and place native trims. This request has not changed Premiere.' }
  }
  if (name === 'beast_start_desktop') {
    try { await connect(); return { ready: true, alreadyRunning: true } } catch { /* attempt the installed application once */ }
    if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) throw new Error('Automatic desktop startup is currently supported on Windows only')
    const executable = path.join(process.env.LOCALAPPDATA, 'Programs', 'beast-downloader', 'beast-downloader.exe')
    const child = spawn(executable, [], { detached: true, windowsHide: true, stdio: 'ignore' })
    const failure = new Promise((resolve) => child.once('error', resolve))
    child.unref()
    for (let attempt = 0; attempt < 20; attempt++) {
      const failed = await Promise.race([failure, new Promise((resolve) => setTimeout(() => resolve(null), 500))])
      if (failed) throw new Error(`Beast failed to start: ${failed.message}`)
      try { await connect(); return { ready: true, alreadyRunning: false } } catch { /* wait for desktop startup */ }
    }
    throw new Error('Beast did not become ready; inspect the desktop app and its logs before retrying')
  }
  const bridge = await connect()
  if (name === 'beast_status') return bridge.snapshotAll()
  if (name === 'beast_add') return bridge.request('batch/add', { text: args.urls.join('\n') })
  if (name === 'beast_download_one') return downloadOne(bridge, args)
  if (name === 'beast_configure_many') {
    const results = []
    for (const id of args.ids) {
      try { results.push({ id, result: await bridge.request('batch/patch', { id, patch: args.patch }) }) }
      catch (error) { results.push({ id, error: error instanceof Error ? error.message : String(error) }) }
    }
    return results
  }
  if (ops.has(name)) return bridge.request(`batch/${ops.get(name)}`, args)
  throw new Error('Unknown tool')
}

async function handle(message) {
  if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') throw new Error('Invalid JSON-RPC request')
  if (message.method === 'initialize') return { protocolVersion: ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'].includes(message.params?.protocolVersion) ? message.params.protocolVersion : '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'beast-downloader-rv', version: '0.1.0' } }
  if (message.method === 'ping') return {}
  if (message.method === 'tools/list') return { tools: definitions }
  if (message.method === 'tools/call') {
    try { const result = await callTool(message.params?.name, message.params?.arguments || {}); return { content: [{ type: 'text', text: JSON.stringify(result) }] } }
    catch (error) { return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] } }
  }
  const error = new Error('Method not found'); error.code = -32601; throw error
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
  for await (const line of input) {
    let request
    try {
      if (Buffer.byteLength(line) > 4 * 1024 * 1024) throw new Error('Request too large')
      request = JSON.parse(line)
      if (!Object.hasOwn(request, 'id')) continue
      const result = await handle(request)
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`)
    } catch (error) {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request?.id ?? null, error: { code: error.code || -32600, message: error.message } })}\n`)
    }
  }
}
