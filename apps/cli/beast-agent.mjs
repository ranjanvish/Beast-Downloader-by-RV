#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { connectDesktop, downloadOne, saveManifest } from './agent-bridge.mjs'

async function main() {
  const [command, inputPath] = process.argv.slice(2)
  if (command === 'status') {
    const bridge = await connectDesktop()
    const rows = await bridge.snapshotAll()
    return { ok: true, rows: rows.map(({ id, title, status, progress, filePath, error }) => ({ id, title, status, progress, filePath, error })) }
  }
  if (command !== 'download' || !inputPath) throw new Error('Usage: node beast-agent.mjs status | download <request.json>')
  const input = JSON.parse(await readFile(inputPath, 'utf8'))
  if (!input.manifest) throw new Error('A manifest output path is required')
  const bridge = await connectDesktop()
  const result = await downloadOne(bridge, input)
  await saveManifest(input.manifest, result)
  return { ok: true, result, manifest: input.manifest }
}

try {
  process.stdout.write(`${JSON.stringify(await main())}\n`)
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`)
  process.exitCode = 1
}
