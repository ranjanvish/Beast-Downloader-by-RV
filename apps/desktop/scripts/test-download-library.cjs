'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const esbuild = require('esbuild')
const root = path.resolve(__dirname, '../../..')
const work = fs.mkdtempSync(path.join(root, 'work-temp/download-library-tests-'))
const state = { tasks: [], workspace: [] }
globalThis.libraryTest = state
const mocks = {
  electron: `exports.app={getPath:()=>${JSON.stringify(work)}}`,
  '@vidbee/task-queue': `exports.isMediaTaskKind=kind=>['video','audio'].includes(kind)`,
  './mixed-batch-host': 'exports.getMixedBatch=()=>({items:globalThis.libraryTest.workspace})',
  './task-queue-host':
    'exports.startDesktopTaskQueue=async()=>{};exports.getDesktopTaskQueue=()=>({get:id=>globalThis.libraryTest.tasks.find(t=>t.id===id),list:()=>({tasks:globalThis.libraryTest.tasks,nextCursor:null})})',
  './projection':
    'exports.projectTaskForRenderer=t=>({id:t.id,title:t.title,url:t.url,type:t.kind,createdAt:t.createdAt,completedAt:t.completedAt})',
  '../utils/logger': 'exports.scopedLoggers={download:{warn:()=>{}}}'
}
async function setup() {
  await esbuild.build({
    entryPoints: [path.join(root, 'apps/desktop/src/main/lib/download-library.ts')],
    outfile: path.join(work, 'host.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    plugins: [
      {
        name: 'library-dependencies',
        setup(build) {
          build.onResolve(
            {
              filter:
                /^(electron|@vidbee\/task-queue)$|^\.\/mixed-batch-host$|^\.\/task-queue-host$|^\.\/projection$|^\.\.\/utils\/logger$/
            },
            (args) => ({ path: args.path, namespace: 'mock' })
          )
          build.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({
            contents: mocks[args.path]
          }))
        }
      }
    ]
  })
  esbuild.buildSync({
    entryPoints: [
      path.join(root, 'apps/desktop/src/shared/download-library.ts'),
      path.join(root, 'packages/downloader-core/src/yt-dlp-args.ts')
    ],
    outdir: path.join(work, 'helpers'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    outExtension: { '.js': '.cjs' }
  })
  return require(path.join(work, 'host.cjs'))
}
const ready = setup()
test('mixed download library keeps image history after clearing the workspace and across restart', async () => {
  const api = await ready
  state.tasks = [
    {
      id: 'v',
      kind: 'video',
      title: 'Video',
      url: 'https://example.com/v',
      status: 'completed',
      createdAt: 100,
      output: { filePath: 'C:\\Downloads\\video.mp4' }
    },
    {
      id: 'a',
      kind: 'audio',
      title: 'Audio',
      url: 'https://example.com/a',
      status: 'running',
      createdAt: 200,
      progress: { percent: 0.5 }
    },
    { id: 'ignore', kind: 'caption', status: 'completed' }
  ]
  state.workspace = [
    {
      id: 'workspace-v',
      kind: 'video',
      taskId: 'v',
      status: 'completed',
      options: { output: 'video' }
    },
    {
      id: 'image',
      kind: 'image',
      title: 'Photo',
      sourceUrl: 'https://example.com/photo.png',
      status: 'completed',
      filePath: 'C:\\Downloads\\photo.png',
      options: { output: 'image', imageUrl: 'https://example.com/photo.png' }
    },
    {
      id: 'queued',
      kind: 'image',
      title: 'Queued image',
      sourceUrl: 'https://example.com/queued.png',
      status: 'queued',
      options: { output: 'image' }
    },
    { id: 'ready', kind: 'video', status: 'ready', options: { output: 'video' } }
  ]
  const snapshot = await api.downloadLibrary()
  assert.deepEqual(snapshot.counts, { all: 4, video: 1, image: 2, audio: 1 })
  assert.equal(snapshot.items.find((r) => r.id === 'a').progress, 50)
  assert.equal(snapshot.items.filter((r) => r.kind === 'video').length, 1)
  const image = snapshot.items.find((r) => r.filePath?.endsWith('photo.png'))
  assert.equal((await api.savedDownloadForPreview(image.id)).filePath, image.filePath)
  assert.equal((await api.savedDownloadForPreview('v')).filePath, 'C:\\Downloads\\video.mp4')
  assert.equal(await api.savedDownloadForPreview('C:\\private.txt'), undefined)
  state.workspace = []
  assert.equal((await api.downloadLibrary(0, 'image')).items.length, 1)
  Reflect.deleteProperty(require.cache, path.join(work, 'host.cjs'))
  const restored = require(path.join(work, 'host.cjs'))
  assert.equal((await restored.downloadLibrary(0, 'image')).items[0].id, image.id)
})
test('category counts, case-insensitive search and pagination include all downloads', async () => {
  await ready
  const file = fs
    .readdirSync(path.join(work, 'helpers'), { recursive: true })
    .find((f) => f.endsWith('download-library.cjs'))
  const { filterDownloadLibrary } = require(path.join(work, 'helpers', file))
  const rows = Array.from({ length: 1001 }, (_, i) => ({
    id: String(i),
    kind: ['video', 'image', 'audio'][i % 3],
    title: `File ${i}`,
    sourceUrl: `https://example.com/${i}`,
    createdAt: i,
    status: 'completed',
    progress: 100,
    filePath: `C:\\Downloads\\file${i}`
  }))
  const all = filterDownloadLibrary(rows)
  assert.equal(all.counts.all, 1001)
  assert.equal(all.pages, 34)
  assert.equal(all.items.length, 30)
  assert.equal(filterDownloadLibrary(rows, 'image').counts.image, 334)
  assert.equal(filterDownloadLibrary(rows, 'audio', 'FILE 999').items[0]?.kind, undefined)
  assert.equal(filterDownloadLibrary(rows, 'all', 'FILE1000').items[0].id, '1000')
  assert.equal(filterDownloadLibrary(rows, 'all', '', 999).page, 33)
})
test('individual download folder overrides the saved default folder', async () => {
  await ready
  const file = fs
    .readdirSync(path.join(work, 'helpers'), { recursive: true })
    .find((f) => f.endsWith('yt-dlp-args.cjs'))
  const { buildDownloadArgs } = require(path.join(work, 'helpers', file))
  const base = { url: 'https://example.com/movie.mp4', type: 'video', format: 'best' }
  const global = buildDownloadArgs(base, 'C:\\Fallback', { downloadPath: 'C:\\Shared' }, [])
  const individual = buildDownloadArgs(
    { ...base, customDownloadPath: 'C:\\Individual' },
    'C:\\Fallback',
    { downloadPath: 'C:\\Shared' },
    []
  )
  assert.ok(global[global.indexOf('-o') + 1].startsWith('C:\\Shared\\'))
  assert.ok(individual[individual.indexOf('-o') + 1].startsWith('C:\\Individual\\'))
  assert.ok(!individual.some((value) => value.includes('C:\\Shared')))
})
