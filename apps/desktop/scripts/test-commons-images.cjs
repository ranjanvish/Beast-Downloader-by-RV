'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const esbuild = require('esbuild')
const root = path.resolve(__dirname, '../../..')
const work = fs.mkdtempSync(path.join(root, 'work-temp/commons-tests-'))
esbuild.buildSync({
  entryPoints: [path.join(root, 'apps/desktop/src/main/lib/image-page-parser.ts')],
  outfile: path.join(work, 'parser.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'silent'
})
const { parseImagePage } = require(path.join(work, 'parser.cjs'))
const files = [
  'Iron_Ore_Train_-_Choum,_Mauritania.jpg',
  'IronOreMauritaniaSahara2007.jpg',
  'SNIM_ore_train_Nouadhibou.jpg'
]
const scans = files.map((file, i) => {
  const html = fs.readFileSync(path.join(root, `work-temp/commons-${i}.html`), 'utf8')
  const scan = parseImagePage(html, `https://commons.wikimedia.org/wiki/File:${file}`)
  assert.equal(scan.images.length, 1)
  const image = scan.images[0]
  assert.ok(image.url.startsWith('https://upload.wikimedia.org/'))
  assert.ok(image.previewUrl.startsWith('https://thumb.wikimedia.org/'))
  assert.ok(!image.url.includes('utm_'))
  assert.ok(image.width >= 1000)
  assert.ok(image.variants.length >= 1)
  assert.ok(!image.title.includes('Wikimedia Foundation'))
  assert.ok(!image.url.includes('CentralAutoLogin'))
  console.log(`PASS: one original photo and thumbnail for ${file}`)
  return scan
})
assert.throws(() =>
  parseImagePage('<img src="/logo.svg">', 'https://commons.wikimedia.org/wiki/File:Missing.jpg')
)
fs.writeFileSync(
  path.join(root, 'work-temp/commons-correct-scans.json'),
  JSON.stringify(scans, null, 2)
)
