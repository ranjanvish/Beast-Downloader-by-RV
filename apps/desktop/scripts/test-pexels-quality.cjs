'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const esbuild = require('esbuild')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

async function main() {
  const desktop = path.resolve(__dirname, '..')
  const root = path.resolve(desktop, '../..')
  const info = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
  assert.equal(info.extractor_key, 'BeastPexels')
  assert.deepEqual(
    info.formats.map((format) => format.height).sort((a, b) => a - b),
    [240, 360, 540, 720, 1080, 1440, 2160]
  )
  const outfile = path.join(root, 'work-temp', 'pexels-quality-component.cjs')
  await esbuild.build({
    entryPoints: [path.join(desktop, 'src/renderer/src/components/download/SingleVideoBeast.tsx')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    external: ['react', 'react-dom', 'react/jsx-runtime'],
    logLevel: 'silent',
    plugins: [
      {
        name: 'headless-image-and-feedback',
        setup(build) {
          build.onResolve({ filter: /remote-image|DownloadParseErrorBanner/ }, (args) => ({
            path: args.path,
            namespace: 'headless'
          }))
          build.onLoad({ filter: /.*/, namespace: 'headless' }, () => ({
            contents:
              'export const RemoteImage = () => null; export const DownloadParseErrorBanner = () => null;'
          }))
        }
      }
    ]
  })
  const { SingleVideoDownload } = require(outfile)
  const html = renderToStaticMarkup(
    React.createElement(SingleVideoDownload, {
      loading: false,
      error: null,
      videoInfo: info,
      state: {
        title: info.title,
        activeTab: 'video',
        selectedVideoFormat: 'pexels-1920x1080-23.98',
        selectedAudioFormat: '',
        customDownloadPath: '',
        startTime: '',
        endTime: ''
      },
      onStateChange: () => {}
    })
  )
  const select = html.match(/<select[^>]*aria-label="Video quality"[^>]*>([\s\S]*?)<\/select>/)[1]
  assert.equal((select.match(/<option/g) || []).length, 7)
  for (const format of info.formats) {
    assert.ok(select.includes(`${format.width}×${format.height} (${format.height}p)`))
    assert.ok(select.includes(`value="${format.format_id}"`))
  }
  assert.ok(!select.includes('unknown'))
  assert.ok(select.indexOf('3840×2160') < select.indexOf('426×240'))
  assert.match(select, /value="pexels-1920x1080-23.98" selected=""/)
  fs.writeFileSync(path.join(root, 'work-temp/pexels-quality-render.html'), html)
  console.log(
    'PASS: actual download component renders all 7 real resolutions, highest first, with exact format IDs and selected 1080p.'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
