'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { spawnSync } = require('node:child_process')
const esbuild = require('esbuild')
const root = path.resolve(__dirname, '../../..')
const work = fs.mkdtempSync(path.join(root, 'work-temp/workspace-ui-'))
async function main() {
  const tested = JSON.parse(
    fs.readFileSync(path.join(root, 'work-temp/installed-mixed-test-state.json'), 'utf8')
  )
  const rows = tested.rows
    .filter((row) => row.status === 'completed')
    .map((row) => ({ ...row, status: 'ready', filePath: row.filePath, error: undefined }))
  const video = rows.find((row) => row.kind === 'video')
  video.options.start = ''
  video.options.end = ''
  const sourceData = Object.fromEntries(
    rows.map((row) => [row.id, { src: pathToFileURL(row.filePath).href, kind: row.kind }])
  )
  const posterFile = rows.find((row) => row.kind === 'image').filePath
  const poster = `data:image/png;base64,${fs.readFileSync(posterFile).toString('base64')}`
  const fixture = { rows, sourceData, poster }
  fs.writeFileSync(path.join(work, 'fixture.json'), JSON.stringify(fixture))
  fs.writeFileSync(
    path.join(work, 'entry.tsx'),
    `
import React from 'react'; import { createRoot } from 'react-dom/client';
import { AllInOneDownloads } from ${JSON.stringify(path.join(root, 'apps/desktop/src/renderer/src/components/download/AllInOneDownloads.tsx'))};
import { initSharedI18n } from ${JSON.stringify(path.join(root, 'packages/i18n/src/index.ts'))};
import { validateMixedOptions } from ${JSON.stringify(path.join(root, 'apps/desktop/src/shared/mixed-download.ts'))};
import i18n from 'i18next'; import { initReactI18next } from 'react-i18next';
import fixture from './fixture.json';
window.fixture=fixture; window.changes=[]; window.validateMixedOptions=validateMixedOptions;
await initSharedI18n(i18n,initReactI18next);
createRoot(document.getElementById('root')).render(<><header className="beast-hero"><h1>Beast Downloader <span className="text-primary">by RV</span></h1><p>Images, audio and video. One queue. Your settings.</p></header><AllInOneDownloads /></>);
`
  )
  const mock = `export const ipcEvents={on:()=>()=>{},removeListener:()=>{}};
export const ipcServices={images:{preview:async()=>window.fixture.poster,consumeImported:async()=>null},fs:{openFileLocation:async()=>{}},dialog:{selectDirectory:async()=>null},batch:{
 snapshot:async()=>({items:structuredClone(window.fixture.rows),page:0,pages:1,total:3,filtered:3,counts:{ready:3},selected:3,downloadableSelected:3,paused:false,fetching:false,concurrency:3}),
 execute:async(action,body)=>{if(action==='patch'){const row=window.fixture.rows.find(r=>r.id===body.id);const options={...row.options,...body.patch};window.validateMixedOptions(row,options);row.options=options;window.changes.push(structuredClone(body.patch));return{changed:1}};return{}},
 preview:async(id)=>window.fixture.sourceData[id]
}};`
  await esbuild.build({
    entryPoints: [path.join(work, 'entry.tsx')],
    outfile: path.join(work, 'ui.js'),
    bundle: true,
    platform: 'browser',
    format: 'esm',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    alias: { '@shared': path.join(root, 'apps/desktop/src/shared') },
    logLevel: 'silent',
    plugins: [
      {
        name: 'mock-ipc',
        setup(build) {
          build.onResolve({ filter: /\/lib\/ipc$/ }, (args) => ({
            path: args.path,
            namespace: 'mock'
          }))
          build.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: mock }))
        }
      }
    ]
  })
  const assets = path.join(root, 'apps/desktop/out/renderer/assets')
  const css = fs
    .readdirSync(assets)
    .find((file) => file.startsWith('index-') && file.endsWith('.css'))
  fs.writeFileSync(
    path.join(work, 'index.html'),
    `<html><head><link rel="stylesheet" href="${pathToFileURL(path.join(assets, css)).href}"><style>${fs.readFileSync(path.join(root, 'apps/desktop/src/renderer/src/assets/global.css'), 'utf8').split('/* RAVIX palette.')[1].replace(' Semantic tokens keep every existing control on the same theme. */', '')}${fs.readFileSync(path.join(root, 'apps/desktop/src/renderer/src/components/download/workspace/workspace.css'), 'utf8')} body{margin:0;background:var(--background);color:var(--foreground);font-family:system-ui} #root{height:auto;overflow:visible} </style></head><body><div id="root"></div><script type="module" src="./ui.js"></script></body></html>`
  )
  const runner = path.join(work, 'runner.cjs')
  fs.writeFileSync(runner, fs.readFileSync(path.join(__dirname, 'workspace-ui-runner.cjs'), 'utf8'))
  const env = { ...process.env }
  env.ELECTRON_RUN_AS_NODE = undefined
  const run = spawnSync(require('electron'), [runner], {
    env,
    stdio: 'inherit',
    windowsHide: true,
    timeout: 90_000
  })
  if (run.status !== 0) {
    throw new Error(`Hidden UI tests failed (${run.status})`)
  }
  console.log(`Hidden Electron UI tests passed. Artifacts: ${work}`)
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
