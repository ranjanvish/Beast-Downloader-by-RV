'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const esbuild = require('esbuild')
const root = path.resolve(__dirname, '../../..')
const work = fs.mkdtempSync(path.join(root, 'work-temp/renderer-csp-tests-'))
esbuild.buildSync({
  entryPoints: [path.join(root, 'apps/desktop/src/main/lib/renderer-csp.ts')],
  outfile: path.join(work, 'csp.cjs'),
  platform: 'node',
  format: 'cjs',
  bundle: true,
  external: ['electron'],
  logLevel: 'silent'
})
const csp = require(path.join(work, 'csp.cjs'))
const directives = (policy) =>
  new Map(
    policy.split(';').map((raw) => {
      const [key, ...values] = raw.trim().split(/\s+/)
      return [key, values]
    })
  )
test('both renderer CSP layers explicitly permit owned media without widening default or script permissions', () => {
  const html = fs.readFileSync(path.join(root, 'apps/desktop/src/renderer/index.html'), 'utf8')
  const meta = html.match(/content="([^"]+)"[\s\S]*?http-equiv="Content-Security-Policy"/)[1]
  const header = csp.buildRendererContentSecurityPolicy('https://api.example.com')
  const merged = csp.mergeRendererContentSecurityPolicy(
    "default-src 'self'; script-src 'self'; img-src 'self'; media-src 'self'; connect-src 'self'",
    'https://api.example.com'
  )
  for (const policy of [meta, header, merged]) {
    const parsed = directives(policy)
    for (const kind of ['img-src', 'media-src', 'connect-src']) {
      assert.ok(parsed.get(kind).includes('batch-media:'), `${kind} blocks previews`)
    }
    assert.deepEqual(parsed.get('default-src'), ["'self'"])
    assert.ok(!parsed.get('script-src').includes('batch-media:'))
    assert.ok(!parsed.get('script-src').includes("'unsafe-inline'"))
  }
})
