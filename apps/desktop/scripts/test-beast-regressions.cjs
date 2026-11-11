'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const esbuild = require('esbuild')
const root = path.resolve(__dirname, '../../..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'beast-tests-'))
const load = (source, name) => {
  const outfile = path.join(temp, `${name}.cjs`)
  esbuild.buildSync({
    entryPoints: [path.join(root, source)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent'
  })
  return require(outfile)
}
const buffer = load('apps/desktop/src/main/lib/metadata-output-buffer.ts', 'buffer')
const beast = load('apps/desktop/src/shared/beast-download.ts', 'beast')
const classifier = load('packages/task-queue/src/classifier/index.ts', 'classifier')
const tokens = load('apps/desktop/src/main/lib/extension-token.ts', 'tokens')
test('metadata larger than 8 MiB stays valid and UTF-8 survives arbitrary chunks', () => {
  const source = Buffer.from(
    JSON.stringify({ title: 'हिन्दी 🎬 日本語', data: 'a'.repeat(9 * 1024 * 1024) })
  )
  const output = buffer.createMetadataOutputBuffer()
  for (let i = 0; i < source.length; i += 7777) {
    output.append(source.subarray(i, i + 7777))
  }
  assert.equal(output.get(), source.toString())
  const split = buffer.createMetadataOutputBuffer()
  for (const byte of Buffer.from('🎬 हिन्दी')) {
    split.append(Buffer.from([byte]))
  }
  assert.equal(split.get(), '🎬 हिन्दी')
})
test('oversized metadata fails explicitly rather than returning broken JSON', () => {
  const b = buffer.createMetadataOutputBuffer(4)
  assert.equal(b.append(Buffer.from('1234')), true)
  assert.equal(b.append(Buffer.from('5')), false)
  assert.throws(() => b.get(), /too much video information/)
})
test('equivalent video fallback preserves height, codec and exact chosen audio', () => {
  const selector = beast.beastVideoSelector(
    { format_id: '230', ext: 'mp4', height: 360, fps: 30, vcodec: 'avc1.4D401E', acodec: 'none' },
    { format_id: '140-3', ext: 'm4a', acodec: 'aac', vcodec: 'none', language: 'hi' }
  )
  assert.equal(selector, '(230/bestvideo[height=360][ext=mp4][vcodec=avc1.4D401E][fps=30])+140-3')
  assert.ok(!selector.includes('bestaudio'))
  assert.ok(!selector.includes('height<'))
})
test('network loss preceding missing-format error remains retryable', () => {
  const result = classifier.classify({
    stderr:
      "RemoteDisconnected('Remote end closed connection without response')\nRequested format is not available",
    exitCode: 1
  })
  assert.equal(result.category, 'network-transient')
  assert.equal(result.retryable, true)
  assert.equal(
    classifier.classify({ stderr: 'Requested format is not available', exitCode: 1 }).category,
    'not-found'
  )
})
test('extension tokens are origin-bound and single use', () => {
  const store = tokens.createExtensionTokenStore()
  const token = store.issue('approved')
  assert.equal(store.consume(token, 'other'), false)
  assert.equal(store.consume(token, 'approved'), true)
  assert.equal(store.consume(token, 'approved'), false)
})
