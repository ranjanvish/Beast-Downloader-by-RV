'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const esbuild = require('esbuild')
const { test } = require('node:test')
const root = path.resolve(__dirname, '../../..')
const scratch = fs.mkdtempSync(path.join(root, 'work-temp/image-tests-'))
let parser
let backend

async function setup() {
  await esbuild.build({
    entryPoints: [path.join(root, 'apps/desktop/src/main/lib/image-page-parser.ts')],
    outfile: path.join(scratch, 'parser.cjs'),
    platform: 'node',
    format: 'cjs',
    bundle: true,
    logLevel: 'silent'
  })
  parser = require(path.join(scratch, 'parser.cjs'))
  await esbuild.build({
    entryPoints: [path.join(root, 'apps/desktop/src/main/lib/image-downloads.ts')],
    outfile: path.join(scratch, 'backend.cjs'),
    platform: 'node',
    format: 'cjs',
    bundle: true,
    logLevel: 'silent',
    plugins: [
      {
        name: 'offline-network-and-electron',
        setup(build) {
          build.onResolve(
            {
              filter:
                /^(electron|node:https?|node:dns\/promises)$|beast-image-converter$|^\.\.\/settings$/
            },
            (args) => ({ path: args.path, namespace: 'test' })
          )
          build.onLoad({ filter: /.*/, namespace: 'test' }, (args) => {
            if (args.path === 'electron') {
              return {
                contents: `exports.app={getPath:()=>${JSON.stringify(scratch)}}; exports.BrowserWindow={getAllWindows:()=>[]}; exports.nativeImage={createFromBuffer:()=>({isEmpty:()=>true})};`
              }
            }
            if (args.path === '../settings') {
              return { contents: 'exports.settingsManager={getAll:()=>({})};' }
            }
            if (args.path.endsWith('beast-image-converter')) {
              return {
                contents:
                  'exports.convertBeastImage=async()=>{throw new Error("Conversion is tested against the installed application")};'
              }
            }
            if (args.path === 'node:dns/promises') {
              return {
                contents:
                  'exports.lookup=async(host)=>[{address:host==="private.example.com"?"10.0.0.8":"93.184.216.34",family:4}];'
              }
            }
            return {
              contents: `const {EventEmitter}=require('node:events'); const {PassThrough}=require('node:stream'); exports.request=(url,options,callback)=>{ const request=new EventEmitter(); request.destroy=e=>request.emit('error',e);request.end=()=>queueMicrotask(()=>{const fixture=globalThis.imageFixtures[url.href];if(!fixture){request.emit('error',new Error('No test fixture'));return;}options.lookup(url.hostname,{},(error,address)=>{if(address!=='93.184.216.34')throw new Error('DNS was not pinned');});const response=new PassThrough();response.statusCode=fixture.status||200;response.headers={'content-type':fixture.mime||'image/png',...(fixture.location?{location:fixture.location}:{})};callback(response);response.end(fixture.body||Buffer.alloc(0));});return request;};`
            }
          })
        }
      }
    ]
  })
  backend = require(path.join(scratch, 'backend.cjs'))
}

test('image sources preserve lazy, relative, responsive, CSS and Google originals without executing scripts', async () => {
  await setup()
  const result = parser.parseImagePage(
    `<img src="/small.jpg" srcset="/large.jpg 1600w, /small.jpg 400w" width="400" height="200" alt="Train"><picture><source srcset="/photo.webp 1200w"><img data-src="/lazy.png"></picture><meta property="og:image" content="/cover.jpg"><a href="https://www.google.com/imgres?imgurl=https%3A%2F%2Fimages.example.com%2Foriginal.jpg">Original</a><div style="background-image:url('/background.png')"></div><img src="file:///secret.png"><script>throw new Error('must not execute');["https://images.example.com/result.jpg",1920,1080]</script>`,
    'https://www.google.com/search?q=train&udm=2'
  )
  assert.ok(
    result.images.some(
      (image) => image.url === 'https://www.google.com/lazy.png' && image.variants[0].width === 1200
    )
  )
  assert.equal(result.images.find((image) => image.title === 'Train').variants[0].width, 1600)
  assert.ok(result.images.some((image) => image.url === 'https://images.example.com/original.jpg'))
  assert.ok(result.images.some((image) => image.width === 1920 && image.height === 1080))
  assert.ok(!result.images.some((image) => image.url.startsWith('file:')))
})

test('private addresses, private DNS and redirects to private addresses are blocked', async () => {
  await backend.readPublicImageResource('http://127.0.0.1/private').then(
    () => assert.fail('private address accepted'),
    () => {}
  )
  await assert.rejects(
    backend.readPublicImageResource('https://private.example.com/image.png'),
    /Private and local/
  )
  globalThis.imageFixtures = {
    'https://images.example.com/redirect': { status: 302, location: 'http://127.0.0.1/private' }
  }
  await assert.rejects(
    backend.readPublicImageResource('https://images.example.com/redirect'),
    /public HTTP/
  )
})

test('mixed batches report failures, sniff image bytes, and never overwrite previous images', async () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS5sAAAAASUVORK5CYII=',
    'base64'
  )
  globalThis.imageFixtures = {
    'https://images.example.com/train.png': { body: png },
    'https://images.example.com/not-image': {
      body: Buffer.from('<html>Not an image</html>'),
      mime: 'image/png'
    }
  }
  const options = {
    images: [
      { url: 'https://images.example.com/train.png', title: '../CON:train' },
      { url: 'https://images.example.com/not-image' }
    ],
    output: 'original',
    directory: scratch
  }
  const first = await backend.saveImages(options)
  assert.equal(first.saved.length, 1)
  assert.equal(first.failed.length, 1)
  assert.equal(path.dirname(first.saved[0].path), scratch)
  assert.deepEqual(fs.readFileSync(first.saved[0].path), png)
  const second = await backend.saveImages({ ...options, images: options.images.slice(0, 1) })
  assert.notEqual(first.saved[0].path, second.saved[0].path)
  await assert.rejects(
    backend.saveImages({ ...options, images: new Array(101).fill(options.images[0]) }),
    /between 1 and 100/
  )
})

test('extension images keep advertised variants and are consumed once by Desktop', () => {
  assert.equal(
    backend.importBrowserImages({
      pageUrl: 'https://www.google.com/search?q=train',
      images: [
        {
          url: 'https://images.example.com/train.png',
          variants: [
            { url: 'https://images.example.com/train-large.png', width: 2000 },
            { url: 'file:///private' }
          ]
        }
      ]
    }),
    1
  )
  const received = backend.consumeImportedImages()
  assert.equal(received.images[0].variants.length, 1)
  assert.equal(received.images[0].variants[0].width, 2000)
  assert.equal(backend.consumeImportedImages(), null)
})

test('the desktop image panel renders format choices and batch controls without browser automation', async () => {
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const translations = require('../../../packages/i18n/src/locales/en.json').imageDownloads
  const outfile = path.join(scratch, 'panel.cjs')
  await esbuild.build({
    entryPoints: [
      path.join(root, 'apps/desktop/src/renderer/src/components/download/ImageDownloads.tsx')
    ],
    outfile,
    platform: 'node',
    format: 'cjs',
    bundle: true,
    jsx: 'automatic',
    external: ['react', 'react/jsx-runtime'],
    logLevel: 'silent',
    plugins: [
      {
        name: 'headless-desktop-boundary',
        setup(build) {
          build.onResolve({ filter: /\/lib\/ipc$|^react-i18next$/ }, (args) => ({
            path: args.path,
            namespace: 'headless'
          }))
          build.onLoad({ filter: /.*/, namespace: 'headless' }, (args) => ({
            contents:
              args.path === 'react-i18next'
                ? `const messages=${JSON.stringify(translations)};exports.useTranslation=()=>({t:key=>messages[key.split('.').pop()]||key});`
                : 'exports.ipcServices={images:{},fs:{}};'
          }))
        }
      }
    ]
  })
  const { ImageDownloads } = require(outfile)
  const html = renderToStaticMarkup(React.createElement(ImageDownloads))
  assert.ok(html.includes('Image downloads'))
  for (const format of ['original', 'png', 'jpeg', 'webp']) {
    assert.ok(html.includes(`value="${format}"`))
  }
  for (const label of [
    'Find images',
    'Minimum width',
    'Choose folder',
    'Save selected',
    'Select first 100'
  ]) {
    assert.ok(html.includes(label))
  }
})
