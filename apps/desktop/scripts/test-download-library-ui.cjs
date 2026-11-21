'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const esbuild = require('esbuild')
const root = path.resolve(__dirname, '../../..')
const work = fs.mkdtempSync(path.join(root, 'work-temp/library-ui-'))
async function main() {
  const rows = ['video', 'image', 'audio'].map((kind, i) => ({
    id: kind,
    title: `Saved ${kind}`,
    kind,
    status: 'completed',
    progress: 100,
    createdAt: Date.now() + i,
    sourceUrl: `https://example.com/${kind}`,
    filePath: `C:\\Saved\\${kind}`
  }))
  fs.writeFileSync(path.join(work, 'rows.json'), JSON.stringify(rows))
  fs.writeFileSync(
    path.join(work, 'entry.tsx'),
    `import React from 'react';import {createRoot} from 'react-dom/client';import {Downloads} from ${JSON.stringify(path.join(root, 'apps/desktop/src/renderer/src/pages/Downloads.tsx'))};import {initSharedI18n} from ${JSON.stringify(path.join(root, 'packages/i18n/src/index.ts'))};import i18n from 'i18next';import {initReactI18next} from 'react-i18next';import rows from './rows.json';window.rows=rows;window.folderCalls=[];window.nextFolder='C:\\\\Shared';window.failSave=false;await initSharedI18n(i18n,initReactI18next);createRoot(document.getElementById('root')).render(<Downloads/>);`
  )
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
        name: 'ui-mocks',
        setup(build) {
          build.onResolve({ filter: /^[A-Za-z]:[\\/]/, namespace: 'mock' }, (args) => ({
            path: args.path,
            namespace: 'file'
          }))
          build.onResolve({ filter: /\/lib\/ipc$|\/store\/settings$/ }, (args) => ({
            path: args.path,
            namespace: 'mock'
          }))
          build.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({
            contents: args.path.endsWith('/store/settings')
              ? `import {atom} from ${JSON.stringify(require.resolve('jotai').split(path.sep).join('/'))};export const settingsAtom=atom({downloadPath:'C:\\\\Original'});`
              : `export const ipcServices={batch:{library:async(page,kind,query)=>{const items=window.rows.filter(r=>(kind==='all'||r.kind===kind)&&r.title.toLowerCase().includes(query.toLowerCase()));return{items,total:items.length,page:0,pages:1,counts:{all:3,video:1,image:1,audio:1}}}},images:{preview:async()=>null},settings:{set:async(key,value)=>{if(window.failSave)throw new Error('Folder save failed');window.folderCalls.push({key,value})}},fs:{selectDirectory:async()=>window.nextFolder,openFile:async()=>true,openFileLocation:async()=>true}};`
          }))
        }
      }
    ]
  })
  fs.writeFileSync(
    path.join(work, 'index.html'),
    '<html><body><div id="root"></div><script type="module" src="ui.js"></script></body></html>'
  )
  fs.writeFileSync(
    path.join(work, 'runner.cjs'),
    String.raw`
const {app,BrowserWindow}=require('electron');const path=require('node:path');const assert=require('node:assert/strict');app.setPath('userData',path.join(__dirname,'profile'));
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,backgroundThrottling:false,offscreen:true}});await win.loadFile(path.join(__dirname,'index.html'));const js=s=>win.webContents.executeJavaScript(s,true);const wait=async(s)=>{for(let i=0;i<120;i++){if(await js(s))return;await new Promise(r=>setTimeout(r,50))}throw new Error('Timeout '+s)};await wait('document.querySelectorAll(\'[data-ui="library-item"]\').length===3');
for(const [index,kind] of ['all','video','image','audio'].entries()){await js('document.querySelectorAll(\'[role="tab"]\')['+index+'].click()');await wait('document.querySelectorAll(\'[data-ui="library-item"]\').length==='+ (index===0?3:1));if(index>0)assert.equal(await js('document.querySelector(\'[data-ui="library-item"]\').dataset.mediaKind'),kind)}
await js('document.querySelectorAll(\'[role="tab"]\')[0].click()');await wait('document.querySelectorAll(\'[data-ui="library-item"]\').length===3');
await js('document.querySelector(\'[data-ui="default-download-folder"] button\').click()');await wait('window.folderCalls.length===1');assert.ok(await js('document.querySelector(\'[data-ui="default-download-folder"]\').textContent.includes("Shared")'));
await js('window.nextFolder=null;document.querySelector(\'[data-ui="default-download-folder"] button\').click()');await new Promise(r=>setTimeout(r,100));assert.equal(await js('window.folderCalls.length'),1);
await js('window.nextFolder="C:\\\\Rejected";window.failSave=true;document.querySelector(\'[data-ui="default-download-folder"] button\').click()');await wait('document.querySelector(\'[role="alert"]\')!==null');assert.ok(await js('document.querySelector(\'[data-ui="default-download-folder"]\').textContent.includes("Shared")'));assert.equal(await js('window.folderCalls.length'),1);
console.log('PASS: All/Video/Image/Audio tabs, saved-path display, default folder picker, cancel and failed-save preservation');app.quit()}).catch(e=>{console.error(e);app.exit(1)})
`
  )
  const result = spawnSync(require('electron'), [path.join(work, 'runner.cjs')], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    stdio: 'inherit',
    windowsHide: true,
    timeout: 45_000
  })
  if (result.status !== 0) {
    throw new Error(`Library UI checks failed (${result.status})`)
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
