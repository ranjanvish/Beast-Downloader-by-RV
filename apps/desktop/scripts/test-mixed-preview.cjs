'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test, after } = require('node:test')
const esbuild = require('esbuild')
const root = path.resolve(__dirname, '../../..')
const work = fs.mkdtempSync(path.join(root, 'work-temp/preview-tests-'))
const state = {
  items: [],
  info: { id: 'v', title: 'Video', formats: [] },
  reads: 0,
  calls: [],
  handler: undefined,
  private: false
}
globalThis.__previewTest = state
const originalFetch = globalThis.fetch
globalThis.fetch = async (url, options) => {
  state.calls.push({ url, options })
  if (state.redirect) {
    const target = state.redirect
    state.redirect = undefined
    return new Response(null, { status: 302, headers: { location: target } })
  }
  return new Response('media-bytes', {
    status: 206,
    headers: { 'Content-Range': 'bytes 0-10/100', 'Content-Type': 'video/mp4' }
  })
}
after(() => {
  globalThis.fetch = originalFetch
})
async function build() {
  await esbuild.build({
    entryPoints: [path.join(root, 'apps/desktop/src/main/lib/mixed-preview.ts')],
    outfile: path.join(work, 'preview.cjs'),
    platform: 'node',
    format: 'cjs',
    bundle: true,
    logLevel: 'silent',
    plugins: [
      {
        name: 'preview-host',
        setup(build) {
          build.onResolve(
            {
              filter:
                /^(electron|node:dns\/promises)$|\.\/mixed-batch-host$|\.\/yt-dlp-info$|\.\/download-library$/
            },
            (args) => ({ path: args.path, namespace: 'test' })
          )
          build.onLoad({ filter: /.*/, namespace: 'test' }, (args) => ({
            contents:
              args.path === 'electron'
                ? `exports.protocol={handle:(_scheme,handler)=>globalThis.__previewTest.handler=handler};exports.net={fetch:async(url,options)=>{globalThis.__previewTest.calls.push({url,options});return new Response('media-bytes',{status:206,headers:{'Content-Range':'bytes 0-10/100','Content-Type':'video/mp4'}})}};`
                : args.path === 'node:dns/promises'
                  ? `exports.lookup=async()=>[{family:4,address:globalThis.__previewTest.private?'127.0.0.1':'142.250.1.1'}]`
                  : args.path.endsWith('download-library')
                    ? 'exports.savedDownloadForPreview=async()=>undefined'
                    : args.path.endsWith('mixed-batch-host')
                      ? 'exports.getMixedBatch=()=>({items:globalThis.__previewTest.items})'
                      : 'exports.fetchVideoInfo=async()=>{globalThis.__previewTest.reads++;return structuredClone(globalThis.__previewTest.info)}'
          }))
        }
      }
    ]
  })
  return require(path.join(work, 'preview.cjs'))
}
const modulePromise = build()
test('preview chooses compatible progressive media, separates audio when necessary and ignores storyboards', async () => {
  const api = await modulePromise
  const info = {
    id: 'v',
    title: 'V',
    formats: [
      {
        format_id: 'sb',
        url: 'https://example.com/sb',
        ext: 'mhtml',
        vcodec: 'none',
        acodec: 'none',
        format_note: 'storyboard'
      },
      {
        format_id: 'v',
        url: 'https://example.com/video',
        ext: 'mp4',
        height: 720,
        vcodec: 'h264',
        acodec: 'none'
      },
      {
        format_id: 'a',
        url: 'https://example.com/audio',
        ext: 'm4a',
        vcodec: 'none',
        acodec: 'aac'
      },
      {
        format_id: 'hls',
        url: 'https://example.com/m3u8',
        ext: 'mp4',
        vcodec: 'h264',
        acodec: 'aac',
        protocol: 'm3u8_native'
      }
    ]
  }
  let selected = api.selectPreviewStreams(info)
  assert.equal(selected.video.format_id, 'v')
  assert.equal(selected.audio.format_id, 'a')
  info.formats.push({
    format_id: 'combined',
    url: 'https://example.com/combined',
    ext: 'mp4',
    height: 360,
    vcodec: 'h264',
    acodec: 'aac'
  })
  selected = api.selectPreviewStreams(info)
  assert.equal(selected.video.format_id, 'combined')
  assert.equal(selected.audio, undefined)
})
test('preview URLs belong to workspace entries, refresh expired metadata and preserve range streaming', async () => {
  const api = await modulePromise
  const id = '01234567-1111-4222-8333-012345678901'
  state.items = [
    { id, sourceUrl: 'https://example.com/movie', kind: 'video', options: { output: 'video' } }
  ]
  state.info = {
    id: 'v',
    title: 'V',
    formats: [
      {
        format_id: 'v',
        url: 'https://example.com/video',
        ext: 'mp4',
        height: 720,
        vcodec: 'h264',
        acodec: 'aac'
      }
    ]
  }
  const first = await api.mixedPreview(id)
  assert.equal(first.src, `batch-media://${id}/video`)
  await api.mixedPreview(id)
  assert.equal(state.reads, 1)
  await api.mixedPreview(id, true)
  assert.equal(state.reads, 2)
  api.registerMixedPreviewProtocol()
  const result = await state.handler(new Request(first.src, { headers: { range: 'bytes=0-10' } }))
  assert.equal(result.status, 206)
  assert.equal(result.headers.get('content-range'), 'bytes 0-10/100')
  assert.equal(state.calls.at(-1).options.headers.get('range'), 'bytes=0-10')
  assert.equal(await result.text(), 'media-bytes')
  state.private = true
  assert.equal((await state.handler(new Request(first.src))).status, 502)
  state.private = false
  assert.equal((await state.handler(new Request('batch-media://missing/saved'))).status, 404)
  state.items[0].filePath = 'C:\\Downloads\\owned.mp4'
  const local = await api.mixedPreview(id)
  assert.equal(local.src, `batch-media://${id}/saved`)
  await state.handler(new Request(local.src, { headers: { range: 'bytes=50-60' } }))
  assert.ok(state.calls.at(-1).url.startsWith('file:'))
  assert.equal(state.calls.at(-1).options.headers.get('range'), 'bytes=50-60')
  await assert.rejects(() => api.mixedPreview('missing'))
})

test('remote previews follow public redirects and revalidate each redirect target', async () => {
  const api = await modulePromise
  state.calls = []
  state.redirect = 'https://example.com/final.mp4'
  const response = await api.fetchPublicPreviewResource(
    'https://example.com/initial.mp4',
    new Headers({ Range: 'bytes=0-10' }),
    new AbortController().signal
  )
  assert.equal(response.status, 206)
  assert.equal(state.calls.length, 2)
  assert.equal(state.calls[1].url, 'https://example.com/final.mp4')
  assert.equal(state.calls[1].options.redirect, 'manual')
  state.redirect = 'http://127.0.0.1/private'
  await assert.rejects(() =>
    api.fetchPublicPreviewResource(
      'https://example.com/initial.mp4',
      new Headers(),
      new AbortController().signal
    )
  )
})
