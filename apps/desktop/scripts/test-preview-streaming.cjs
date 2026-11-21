'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const esbuild = require('esbuild')
const root = path.resolve(__dirname, '../../..')
const work = fs.mkdtempSync(path.join(root, 'work-temp/preview-streaming-'))
async function main() {
  const saved = JSON.parse(
    fs.readFileSync(path.join(root, 'work-temp/installed-mixed-test-state.json'), 'utf8')
  ).rows.filter((row) => row.status === 'completed')
  const pexels = JSON.parse(
    fs.readFileSync(path.join(root, 'work-temp/pexels-all-qualities.json'), 'utf8')
  )
  const info = {
    id: pexels.id,
    title: pexels.title,
    formats: pexels.formats
      .filter((f) => f.height === 240)
      .map((f) => ({
        format_id: f.format_id,
        url: f.url,
        ext: f.ext,
        vcodec: f.vcodec,
        acodec: f.acodec,
        height: f.height,
        protocol: f.protocol
      }))
  }
  const currentFile = path.join(root, 'work-temp/preview-current-entries.json')
  const current = fs.existsSync(currentFile)
    ? JSON.parse(fs.readFileSync(currentFile, 'utf8').replace(/^\uFEFF/, '')).items
    : []
  if (process.argv.includes('--commons')) {
    const scans = JSON.parse(
      fs.readFileSync(path.join(root, 'work-temp/commons-correct-scans.json'), 'utf8')
    )
    current.splice(
      0,
      current.length,
      ...scans.map((scan, i) => ({
        id: `11111111-2222-4333-8444-00000000000${i}`,
        kind: 'image',
        title: scan.images[0].title,
        sourceUrl: scan.pageUrl,
        pageUrl: scan.pageUrl,
        image: scan.images[0],
        options: { output: 'image', imageUrl: scan.images[0].url }
      }))
    )
  }
  const infoByUrl = {}
  const actual = []
  for (const row of current) {
    if (row.kind === 'image') {
      actual.push(row)
      continue
    }
    const rawFile = path.join(root, `work-temp/preview-actual-${row.id}.json`)
    if (!fs.existsSync(rawFile)) {
      continue
    }
    const raw = JSON.parse(fs.readFileSync(rawFile, 'utf8').replace(/^\uFEFF/, ''))
    infoByUrl[row.sourceUrl] = {
      id: raw.id,
      title: raw.title,
      formats: raw.formats.map((f) => ({
        format_id: f.format_id,
        url: f.url,
        ext: f.ext,
        vcodec: f.vcodec,
        acodec: f.acodec,
        height: f.height,
        protocol: f.protocol
      }))
    }
    actual.push(row)
  }
  fs.writeFileSync(
    path.join(work, 'fixture.json'),
    JSON.stringify({
      saved: [...saved, ...actual],
      info,
      infoByUrl,
      actualIds: actual.map((row) => row.id)
    })
  )
  await esbuild.build({
    entryPoints: [path.join(root, 'apps/desktop/src/main/lib/mixed-preview.ts')],
    outfile: path.join(work, 'preview.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    logLevel: 'silent',
    plugins: [
      {
        name: 'fixture-owner',
        setup(build) {
          build.onResolve(
            { filter: /\.\/mixed-batch-host$|\.\/yt-dlp-info$|\.\/download-library$/ },
            (args) => ({
              path: args.path,
              namespace: 'fixture'
            })
          )
          build.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
            contents: args.path.endsWith('download-library')
              ? 'exports.savedDownloadForPreview=async()=>undefined'
              : args.path.endsWith('mixed-batch-host')
                ? 'exports.getMixedBatch=()=>({items:globalThis.previewFixture.saved})'
                : 'exports.fetchVideoInfo=async(url)=>globalThis.previewFixture.infoByUrl[url] || globalThis.previewFixture.info'
          }))
        }
      }
    ]
  })
  await esbuild.build({
    entryPoints: [path.join(root, 'apps/desktop/src/main/lib/renderer-csp.ts')],
    outfile: path.join(work, 'csp.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    logLevel: 'silent'
  })
  const sourceHtml = fs.readFileSync(
    path.join(root, 'apps/desktop/src/renderer/index.html'),
    'utf8'
  )
  const metaPolicy = sourceHtml.match(
    /content="([^"]+)"[\s\S]*?http-equiv="Content-Security-Policy"/
  )[1]
  fs.writeFileSync(path.join(work, 'meta-policy.json'), JSON.stringify(metaPolicy))
  fs.writeFileSync(
    path.join(work, 'index.html'),
    `<html><head><meta http-equiv="Content-Security-Policy" content="${metaPolicy}"></head><body><video controls></video><audio controls></audio><img alt="preview"></body></html>`
  )
  fs.writeFileSync(
    path.join(work, 'runner.cjs'),
    `
const {app,BrowserWindow,protocol}=require('electron');const path=require('node:path');const assert=require('node:assert/strict');
app.setPath('userData',path.join(__dirname,'profile'));app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
protocol.registerSchemesAsPrivileged([{scheme:'batch-media',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true,corsEnabled:true}}]);
globalThis.previewFixture=require('./fixture.json');const api=require('./preview.cjs');const csp=require('./csp.cjs');const fs=require('node:fs');const metaPolicy=require('./meta-policy.json');
const headerPolicy=csp.buildRendererContentSecurityPolicy('https://api.example.com');
fs.writeFileSync(path.join(__dirname,'legacy.html'),'<html><head><meta http-equiv="Content-Security-Policy" content="'+metaPolicy.replaceAll('batch-media:','')+'"></head><body><img alt="preview"></body></html>');
csp.setupRendererContentSecurityPolicy('https://api.example.com');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
api.registerMixedPreviewProtocol();const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,backgroundThrottling:false}});const js=s=>win.webContents.executeJavaScript(s,true);
const wait=async(s)=>{for(let i=0;i<300;i++){if(await js(s))return;await sleep(100)}throw new Error('Timeout '+s+' '+await js('JSON.stringify({error:document.querySelector("video")?.error?.message,state:document.querySelector("video")?.networkState})'))};
await win.loadFile(path.join(__dirname,'legacy.html'));await js("window.previewViolations=[];document.addEventListener('securitypolicyviolation',e=>window.previewViolations.push(e.violatedDirective))");
const blocked=await api.mixedPreview(previewFixture.saved.find(r=>r.kind==='image').id);await js('document.querySelector("img").src='+JSON.stringify(blocked.src));await wait('window.previewViolations.includes("img-src")');console.log('PASS: legacy production CSP reproduces the reported preview failure');
await win.loadFile(path.join(__dirname,'index.html'));await js('(()=>{const meta=document.createElement("meta");meta.httpEquiv="Content-Security-Policy";meta.content='+JSON.stringify(headerPolicy)+';document.head.append(meta);window.previewViolations=[];document.addEventListener("securitypolicyviolation",e=>window.previewViolations.push(e.violatedDirective))})()');
for(const row of previewFixture.saved){
 const media=await api.mixedPreview(row.id);
 if(previewFixture.infoByUrl[row.sourceUrl]){const chosen=api.selectPreviewStreams(previewFixture.infoByUrl[row.sourceUrl]);console.log('Stream selection: '+row.title+' '+JSON.stringify({id:chosen.video?.format_id,codec:chosen.video?.vcodec,ext:chosen.video?.ext,audio:chosen.audio?.format_id}));const response=await api.fetchPublicPreviewResource(chosen.video.url,new Headers({Range:'bytes=0-1023'}),new AbortController().signal);console.log('Stream HTTP status: '+response.status);await response.body?.cancel()}
 const tag=row.kind==='image'?'img':row.kind==='audio'?'audio':'video';
 await js('document.querySelector('+JSON.stringify(tag)+').src='+JSON.stringify(media.src));
 if(tag==='img'){await wait('document.querySelector("img").naturalWidth>0')}else{await wait('document.querySelector('+JSON.stringify(tag)+').readyState>=1');await js('document.querySelector('+JSON.stringify(tag)+').play()');await wait('document.querySelector('+JSON.stringify(tag)+').currentTime>0.1');await js('document.querySelector('+JSON.stringify(tag)+').pause()')}
 console.log('PASS production-policy preview playback: '+row.kind+' '+(row.title || ''))
}
const row=previewFixture.saved.find(r=>r.kind==='video' && r.filePath);delete row.filePath;const media=await api.mixedPreview(row.id,true);
const probe=await api.fetchPublicPreviewResource(previewFixture.info.formats[0].url,new Headers({Range:'bytes=0-1023'}),new AbortController().signal);console.log('Direct preview probe status: '+probe.status);await probe.body?.cancel();
const range=await js('fetch('+JSON.stringify(media.src)+',{headers:{Range:"bytes=0-1023"}}).then(async r=>({status:r.status,bytes:(await r.arrayBuffer()).byteLength}))');assert.equal(range.status,206);assert.equal(range.bytes,1024);
await js('document.querySelector("video").src='+JSON.stringify(media.src));await wait('document.querySelector("video").readyState>=1');await js('document.querySelector("video").play()');await wait('document.querySelector("video").currentTime>0.1');await js('document.querySelector("video").pause()');console.log('PASS real Pexels remote protocol under both production CSPs: HTTP 206 range, decoding and playback');assert.deepEqual(await js('window.previewViolations'),[]);app.quit()
}).catch(e=>{console.error(e);app.exit(1)})
 `
  )
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: undefined }
  const result = spawnSync(require('electron'), [path.join(work, 'runner.cjs')], {
    env,
    stdio: 'inherit',
    windowsHide: true,
    timeout: 120_000
  })
  if (result.status !== 0) {
    throw new Error(`Streaming tests failed (${result.status})`)
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
