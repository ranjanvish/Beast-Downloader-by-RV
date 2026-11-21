'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const esbuild = require('esbuild')
const root = path.resolve(__dirname, '../../..')
const scratch = fs.mkdtempSync(path.join(root, 'work-temp/mixed-batch-tests-'))
esbuild.buildSync({
  entryPoints: [
    path.join(root, 'apps/desktop/src/main/lib/mixed-batch.ts'),
    path.join(root, 'apps/desktop/src/shared/mixed-download.ts'),
    path.join(root, 'apps/desktop/workspace-source-resolve.ts')
  ],
  outdir: scratch,
  outbase: path.join(root, 'apps/desktop'),
  platform: 'node',
  format: 'cjs',
  bundle: true,
  logLevel: 'silent',
  outExtension: { '.js': '.cjs' }
})
const { MixedBatch } = require(path.join(scratch, 'src/main/lib/mixed-batch.cjs'))
const helpers = require(path.join(scratch, 'src/shared/mixed-download.cjs'))
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const waitFor = async (predicate) => {
  for (let i = 0; i < 1600; i++) {
    if (predicate()) {
      return
    }
    await delay(5)
  }
  assert.fail('Timed out waiting for batch state')
}
const video = {
  id: 'movie',
  title: 'Test video',
  duration: 30,
  formats: [
    { format_id: 'v360', ext: 'mp4', width: 640, height: 360, vcodec: 'h264', acodec: 'none' },
    { format_id: 'v720', ext: 'mp4', width: 1280, height: 720, vcodec: 'h264', acodec: 'none' },
    { format_id: 'v1080', ext: 'mp4', width: 1920, height: 1080, vcodec: 'h264', acodec: 'none' },
    { format_id: 'a', ext: 'm4a', vcodec: 'none', acodec: 'aac', language: 'en' }
  ]
}
const audio = {
  id: 'song',
  title: 'Test audio',
  duration: 30,
  formats: [{ format_id: 'a', ext: 'mp3', vcodec: 'none', acodec: 'mp3' }]
}
const make = (overrides = {}, saved = []) => {
  const tasks = new Map(),
    admitted = [],
    savedImages = []
  const dependencies = {
    videoInfo: async (url) =>
      url.endsWith('.mp3') ? structuredClone(audio) : structuredClone(video),
    images: async (url) => ({
      pageUrl: url,
      images: [
        {
          url,
          title: 'Test image',
          width: 640,
          height: 360,
          variants: [{ url: `${url}?size=large`, width: 1600 }]
        }
      ]
    }),
    saveImage: async (row) => {
      savedImages.push(row)
      return `/saved/${row.id}.png`
    },
    startMedia: async (row) => {
      const id = `task-${row.id}`
      admitted.push(helpers.mixedMediaOptions(row))
      tasks.set(id, { status: 'running', progress: 50 })
      return id
    },
    mediaState: (id) => tasks.get(id),
    cancelMedia: async (id) => {
      tasks.set(id, { status: 'cancelled', progress: 0 })
    },
    resumeMedia: async (id) => {
      tasks.set(id, { status: 'running', progress: 0 })
    },
    persist: () => {},
    ...overrides
  }
  return { batch: new MixedBatch(dependencies, saved), tasks, admitted, savedImages }
}

test('1,000 links have bounded metadata concurrency, deduplication and pagination; one failure does not stop the rest', async () => {
  let active = 0,
    maximum = 0
  const { batch } = make({
    videoInfo: async (url) => {
      active++
      maximum = Math.max(maximum, active)
      await delay(1)
      active--
      if (url.endsWith('/17')) {
        throw new Error('HTTP 403 Forbidden')
      }
      return structuredClone(video)
    }
  })
  try {
    const urls = Array.from({ length: 1000 }, (_, i) => `https://example.com/${i}`)
    const result = batch.add([...urls, urls[0], 'not a link'].join('\n'))
    assert.equal(result.added, 1000)
    assert.equal(result.duplicates, 1)
    assert.equal(result.invalid.length, 1)
    batch.fetch()
    await waitFor(() => !batch.snapshot().fetching)
    assert.equal(maximum, 3)
    assert.equal(batch.snapshot().counts.ready, 999)
    assert.equal(batch.snapshot().counts.failed, 1)
    assert.equal(batch.snapshot().pages, 50)
    assert.equal(batch.snapshot(49).items.length, 20)
  } finally {
    batch.dispose()
  }
})

test('mixed image/audio/video rows retain separate settings, exact video selection, clips and independent progress', async () => {
  const { batch, tasks, admitted, savedImages } = make()
  try {
    batch.add(
      'https://example.com/photo.png\nhttps://example.com/song.mp3\nhttps://example.com/movie'
    )
    batch.fetch()
    await waitFor(() => !batch.snapshot().fetching)
    assert.deepEqual(
      batch.items.map((row) => row.kind),
      ['image', 'audio', 'video']
    )
    assert.equal(
      batch.bulk({
        height: 720,
        audioOutput: 'mp3',
        audioBitrate: 320,
        imageOutput: 'webp',
        folder: '/saved'
      }).changed,
      3
    )
    const movie = batch.items.find((row) => row.kind === 'video')
    assert.equal(movie.options.videoFormat, 'v720')
    assert.throws(() => batch.patch(movie.id, { start: '00:20', end: '00:10' }), /end after start/)
    batch.patch(movie.id, { start: '00:01', end: '00:02' })
    assert.equal(batch.start().queued, 3)
    await waitFor(() => admitted.length === 2 && savedImages.length === 1)
    assert.equal(savedImages[0].options.imageOutput, 'webp')
    const selected = admitted.find((row) => row.type === 'video')
    assert.equal(selected.format, '(v720/bestvideo[height=720][ext=mp4][vcodec=h264])+a')
    assert.equal(selected.audioFormat, '')
    assert.equal(selected.startTime, '00:01')
    assert.equal(admitted.find((row) => row.type === 'audio').audioFormat, 'mp3')
    for (const [id] of tasks) {
      tasks.set(id, { status: 'completed', progress: 100, path: `/saved/${id}.mp4` })
    }
    batch.tick()
    await waitFor(() => batch.snapshot().counts.completed === 3)
  } finally {
    batch.dispose()
  }
})

test('gallery expansion, explicit retry and duplication do not lose other entries', async () => {
  let attempts = 0
  const { batch } = make({
    videoInfo: async () => {
      throw new Error('Unsupported URL')
    },
    images: async (url) => ({
      pageUrl: url,
      images: [
        { url: 'https://example.com/a.png', title: 'A', variants: [] },
        { url: 'https://example.com/b.png', title: 'B', variants: [] }
      ]
    }),
    saveImage: async (row) => {
      if (row.title === 'A' && attempts++ === 0) {
        throw new Error('Temporary failure')
      }
      return `/saved/${row.id}.png`
    }
  })
  try {
    batch.add('https://example.com/gallery')
    batch.fetch()
    await waitFor(() => !batch.snapshot().fetching)
    assert.equal(batch.items.length, 2)
    batch.start()
    await waitFor(() => batch.snapshot().counts.failed === 1)
    batch.tick()
    await waitFor(() => batch.snapshot().counts.completed === 1)
    batch.retry()
    await waitFor(() => batch.snapshot().counts.completed === 2)
    batch.clone(batch.items[0].id)
    assert.equal(batch.items.length, 3)
    assert.equal(batch.items[2].status, 'ready')
    assert.notEqual(batch.items[0].id, batch.items[2].id)
  } finally {
    batch.dispose()
  }
})

test('restore never automatically duplicates an interrupted image; a saved paused media task resumes by its original ID', async () => {
  const first = make()
  first.batch.add('https://example.com/image.png')
  first.batch.fetch()
  await waitFor(() => !first.batch.snapshot().fetching)
  const saved = structuredClone(first.batch.items)
  first.batch.dispose()
  saved[0].status = 'downloading'
  const { batch, admitted, tasks } = make({}, saved)
  try {
    assert.equal(batch.items[0].status, 'ready')
    assert.equal(admitted.length, 0)
    batch.items.push({
      ...structuredClone(batch.items[0]),
      id: 'paused-media',
      kind: 'video',
      image: undefined,
      info: video,
      status: 'paused',
      taskId: 'original-task',
      options: { ...helpers.emptyMixedOptions(), videoFormat: 'v720', audioTrack: 'a' }
    })
    tasks.set('original-task', { status: 'paused', progress: 25 })
    batch.start(['paused-media'])
    await delay(1)
    batch.tick()
    assert.equal(admitted.length, 0)
    assert.equal(batch.items[1].taskId, 'original-task')
    assert.equal(tasks.get('original-task').status, 'running')
  } finally {
    batch.dispose()
  }
})

test('build aliases use current translations and scheduler sources rather than copied dependencies', () => {
  const { workspaceSourceAliases } = require(path.join(scratch, 'workspace-source-resolve.cjs'))
  const aliases = workspaceSourceAliases(path.join(root, 'apps/desktop'))
  assert.equal(aliases['@vidbee/i18n'], path.join(root, 'packages/i18n/src/index.ts'))
  assert.equal(
    aliases['@vidbee/task-queue/process'],
    path.join(root, 'packages/task-queue/src/process/index.ts')
  )
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(root, 'packages/i18n/src/locales/en.json'))).imageDownloads
      .images,
    'Images'
  )
})

test('playlist URLs expand to individually editable entries and are not re-added on a second paste', async () => {
  const { batch } = make({
    playlist: async () => ({
      entries: [
        { url: 'https://example.com/clip-one' },
        { url: 'https://example.com/clip-two' },
        { url: 'https://example.com/clip-three' }
      ]
    })
  })
  try {
    const url = 'https://www.youtube.com/playlist?list=PL-test'
    batch.add(url)
    batch.fetch()
    await waitFor(() => !batch.snapshot().fetching)
    assert.equal(batch.items.length, 3)
    assert.equal(batch.snapshot().counts.ready, 3)
    assert.equal(batch.add(url).duplicates, 1)
    assert.ok(batch.items.every((row) => row.pageUrl === url))
  } finally {
    batch.dispose()
  }
})

test('audio output choices reach FFmpeg correctly instead of silently forcing MP3', () => {
  const outfile = path.join(scratch, 'audio-args.cjs')
  esbuild.buildSync({
    entryPoints: [path.join(root, 'packages/downloader-core/src/yt-dlp-args.ts')],
    outfile,
    platform: 'node',
    format: 'cjs',
    bundle: true,
    logLevel: 'silent'
  })
  const { buildDownloadArgs } = require(outfile)
  for (const format of ['mp3', 'm4a', 'wav', 'flac', 'opus', 'ogg']) {
    const args = buildDownloadArgs(
      {
        url: 'https://example.com/song.mp3',
        type: 'audio',
        format: 'a',
        audioFormat: format,
        audioBitrate: 192
      },
      scratch,
      {}
    )
    assert.equal(args[args.indexOf('--audio-format') + 1], format === 'ogg' ? 'vorbis' : format)
    assert.equal(args.includes('--audio-quality'), !['wav', 'flac'].includes(format))
  }
  const best = buildDownloadArgs(
    { url: 'https://example.com/song.mp3', type: 'audio', format: 'a', audioFormat: 'mp3' },
    scratch,
    {}
  )
  assert.equal(best[best.indexOf('--audio-quality') + 1], '0')
})

test('the real chooser shows type-specific options and current translated labels in one workspace', async () => {
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const entry = path.join(scratch, 'chooser-entry.tsx')
  fs.writeFileSync(
    entry,
    `import { AllInOneDownloads, BatchRow } from ${JSON.stringify(path.join(root, 'apps/desktop/src/renderer/src/components/download/AllInOneDownloads.tsx'))}; import { initSharedI18n } from ${JSON.stringify(path.join(root, 'packages/i18n/src/index.ts'))}; import i18n from 'i18next'; import { initReactI18next } from 'react-i18next'; export { AllInOneDownloads, BatchRow, i18n }; export const initialize = () => initSharedI18n(i18n, initReactI18next);`
  )
  await esbuild.build({
    entryPoints: [entry],
    outfile: path.join(scratch, 'chooser.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    logLevel: 'silent',
    external: ['react', 'react-dom', 'react/jsx-runtime', 'react-i18next', 'i18next'],
    alias: { '@shared': path.join(root, 'apps/desktop/src/shared') },
    plugins: [
      {
        name: 'headless-ipc',
        setup(build) {
          build.onResolve({ filter: /\/lib\/ipc$/ }, (args) => ({
            path: args.path,
            namespace: 'headless'
          }))
          build.onLoad({ filter: /.*/, namespace: 'headless' }, () => ({
            contents: 'exports.ipcServices={images:{},batch:{},fs:{}};exports.ipcEvents={};'
          }))
        }
      }
    ]
  })
  const ui = require(path.join(scratch, 'chooser.cjs'))
  await ui.initialize()
  assert.equal(ui.i18n.t('imageDownloads.images'), 'Images')
  assert.equal(ui.i18n.t('batch.title'), 'All-in-one downloader')
  const html = renderToStaticMarkup(React.createElement(ui.AllInOneDownloads))
  assert.equal((html.match(/<textarea/g) || []).length, 1)
  assert.ok(html.includes('All-in-one downloader'))
  assert.ok(html.includes('Download selected'))
  assert.ok(!html.includes('imageDownloads.media'))
  const { batch } = make()
  try {
    batch.add(
      'https://example.com/photo.png\nhttps://example.com/song.mp3\nhttps://example.com/movie'
    )
    batch.fetch()
    await waitFor(() => !batch.snapshot().fetching)
    for (const row of batch.items) {
      const rendered = renderToStaticMarkup(
        React.createElement(ui.BatchRow, { entry: row, command: async () => true })
      )
      if (row.kind === 'image') {
        assert.ok(rendered.includes('aria-label="Image size"'))
        assert.ok(!rendered.includes('aria-label="Video resolution"'))
      } else if (row.kind === 'audio') {
        assert.ok(rendered.includes('aria-label="Audio format"'))
        assert.ok(!rendered.includes('aria-label="Image output"'))
      } else {
        assert.ok(rendered.includes('aria-label="Video resolution"'))
        assert.ok(rendered.includes('1920×1080'))
      }
    }
  } finally {
    batch.dispose()
  }
})

test('clip times round-trip milliseconds, reject invalid ranges and exclude silent storyboards from audio', () => {
  for (const seconds of [0, 0.01, 5.125, 59.999, 60, 3599.995, 3600, 3661.25]) {
    assert.ok(Math.abs(helpers.parseClipTime(helpers.formatClipTime(seconds)) - seconds) < 0.001)
  }
  assert.equal(helpers.parseClipTime('1:02.5'), 62.5)
  assert.equal(helpers.parseClipTime('12.25'), 12.25)
  assert.ok(Number.isNaN(helpers.parseClipTime('1:99')))
  const info = structuredClone(video)
  info.formats.push({
    format_id: 'sb2',
    ext: 'mhtml',
    vcodec: 'none',
    acodec: 'none',
    format_note: 'storyboard'
  })
  assert.deepEqual(
    helpers.audioFormats(info).map((f) => f.format_id),
    ['a']
  )
  const saved = {
    id: 'restore-storyboard',
    sourceUrl: 'https://example.com/video',
    kind: 'video',
    status: 'ready',
    selected: true,
    progress: 0,
    title: 'Restored video',
    info,
    options: { ...helpers.emptyMixedOptions(), videoFormat: 'v720', audioTrack: 'sb2' }
  }
  const { batch } = make({}, [saved])
  try {
    assert.equal(batch.items[0].options.audioTrack, 'a')
    const item = batch.items[0]
    assert.throws(() =>
      helpers.validateMixedOptions(item, { ...item.options, start: '20', end: '10' })
    )
    assert.throws(() => helpers.validateMixedOptions(item, { ...item.options, end: '31' }))
    helpers.validateMixedOptions(item, {
      ...item.options,
      start: '00:00:02.125',
      end: '00:00:15.750'
    })
    const options = helpers.mixedMediaOptions({
      ...item,
      options: { ...item.options, start: '2.125', end: '15.75' }
    })
    assert.equal(options.startTime, '2.125')
    assert.equal(options.endTime, '15.75')
    assert.equal(options.selectedFormat.format_id, 'v720')
  } finally {
    batch.dispose()
  }
})
