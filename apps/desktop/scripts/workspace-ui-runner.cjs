'use strict'
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
app.setPath('userData', path.join(__dirname, 'electron-profile'))
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
app
  .whenReady()
  .then(async () => {
    const window = new BrowserWindow({
      show: false,
      width: 1440,
      height: 1100,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        offscreen: true
      }
    })
    const errors = []
    window.webContents.on('console-message', (event) => {
      if (event.level === 'error') {
        errors.push(event.message)
      }
    })
    const js = (source) => window.webContents.executeJavaScript(source, true)
    const waitFor = async (source) => {
      for (let i = 0; i < 160; i++) {
        if (await js(source)) {
          return
        }
        await sleep(100)
      }
      throw new Error(`Timed out: ${source}; ${errors.join('; ')}`)
    }
    await window.loadFile(path.join(__dirname, 'index.html'))
    await waitFor(`document.querySelectorAll('[data-ui="media-card"]').length===3`)
    assert.equal(await js(`document.querySelectorAll('[data-ui="item-details"][open]').length`), 0)
    assert.equal(await js(`document.querySelectorAll('[data-ui="trim-editor"]').length`), 2)
    assert.equal(await js(`document.querySelectorAll('input[type="range"]').length`), 2)
    await waitFor(`document.querySelectorAll('.beast-preview-tile img').length===2`)
    const lightImage = await window.capturePage()
    fs.writeFileSync(path.join(__dirname, 'workspace-light.png'), lightImage.toPNG())
    const card = `document.querySelector('[data-media-kind="video"]')`
    assert.ok(await js(`${card}.getBoundingClientRect().height < 160`))
    await js(`${card}.querySelector('summary').click()`)
    await waitFor(`${card}.querySelector('details').open`)
    await js(`${card}.querySelector('summary').click()`)
    assert.equal(await js(`${card}.querySelector('details').open`), false)
    await js(`${card}.querySelector('summary').click()`)
    const setInput = async (label, value, event = 'input') =>
      js(
        `(()=>{const el=${card}.querySelector('[aria-label="${label}"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('${event}',{bubbles:true}));})()`
      )
    await setInput('Start time', '00:00:02.125')
    await sleep(60)
    await js(
      `${card}.querySelector('[aria-label="Start time"]').dispatchEvent(new FocusEvent('focusout',{bubbles:true}))`
    )
    await waitFor(`window.fixture.rows.find(r=>r.kind==='video').options.start==='00:00:02.125'`)
    await setInput('End time', '00:00:10.500')
    await sleep(60)
    await js(
      `${card}.querySelector('[aria-label="End time"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`
    )
    await waitFor(`window.fixture.rows.find(r=>r.kind==='video').options.end==='00:00:10.500'`)
    await setInput('Trim start slider', '4.25')
    await sleep(60)
    await js(
      `${card}.querySelector('[aria-label="Trim start slider"]').dispatchEvent(new PointerEvent('pointerup',{bubbles:true}))`
    )
    await waitFor(`window.fixture.rows.find(r=>r.kind==='video').options.start==='00:00:04.250'`)
    await setInput('Trim end slider', '8.75')
    await sleep(60)
    await js(
      `${card}.querySelector('[aria-label="Trim end slider"]').dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowLeft',bubbles:true}))`
    )
    await waitFor(`window.fixture.rows.find(r=>r.kind==='video').options.end==='00:00:08.750'`)
    await js(`${card}.scrollIntoView({block:'start'})`)
    await sleep(400)
    const trimImage = await window.capturePage()
    fs.writeFileSync(path.join(__dirname, 'workspace-trim.png'), trimImage.toPNG())
    const before = await js('window.changes.length')
    await setInput('End time', '1')
    await sleep(60)
    await js(
      `${card}.querySelector('[aria-label="End time"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`
    )
    await sleep(100)
    assert.equal(await js('window.changes.length'), before)
    assert.ok(await js(`${card}.querySelector('[role="alert"]')!==null`))
    await js(`${card}.querySelector('[data-ui="trim-editor"] button').click()`)
    await waitFor(
      `window.fixture.rows.find(r=>r.kind==='video').options.start==='' && window.fixture.rows.find(r=>r.kind==='video').options.end===''`
    )
    for (const kind of ['video', 'audio', 'image']) {
      const wasOpen = await js(`document.querySelector('[data-media-kind="${kind}"] details').open`)
      await js(
        `document.querySelector('[data-media-kind="${kind}"] [data-ui="media-preview"]').click()`
      )
      await waitFor(
        `document.querySelector('.beast-preview-dialog') && getComputedStyle(document.querySelector('.beast-preview-dialog')).opacity === '1'`
      )
      await sleep(400)
      assert.equal(
        await js(`document.querySelector('[data-media-kind="${kind}"] details').open`),
        wasOpen
      )
      const selector =
        kind === 'video' ? 'video' : kind === 'audio' ? 'audio' : '.beast-full-preview'
      await waitFor(`document.querySelector('.beast-preview-dialog ${selector}')!==null`)
      if (kind === 'image') {
        await waitFor(`document.querySelector('.beast-full-preview').naturalWidth>0`)
      } else {
        await waitFor(`document.querySelector('.beast-preview-dialog ${selector}').readyState>=1`)
        await js(`document.querySelector('.beast-preview-dialog ${selector}').play()`)
        await waitFor(`document.querySelector('.beast-preview-dialog ${selector}').currentTime>0.1`)
        await js(`document.querySelector('.beast-preview-dialog ${selector}').pause()`)
      }
      await window
        .capturePage()
        .then((image) =>
          fs.writeFileSync(path.join(__dirname, `preview-${kind}.png`), image.toPNG())
        )
      await js(
        `document.querySelector('.beast-preview-dialog button[data-slot="dialog-close"]').click()`
      )
      await waitFor(`document.querySelector('.beast-preview-dialog')===null`)
      assert.equal(await js(`document.querySelectorAll('video,audio').length`), 0)
    }
    window.setSize(640, 1000)
    await sleep(300)
    assert.ok(await js('document.documentElement.scrollWidth<=window.innerWidth+1'))
    const compactImage = await window.capturePage()
    fs.writeFileSync(path.join(__dirname, 'workspace-compact.png'), compactImage.toPNG())
    window.setSize(1440, 1100)
    await js(`document.documentElement.classList.add('dark')`)
    await sleep(100)
    const darkImage = await window.capturePage()
    fs.writeFileSync(path.join(__dirname, 'workspace-dark.png'), darkImage.toPNG())
    assert.deepEqual(errors, [])
    console.log(
      'PASS: typed timestamps, both sliders, atomic persistence, invalid range, reset, image/video thumbnails and audio waveform tile, image viewer, real audio/video playback, player cleanup and compact layout'
    )
    app.quit()
  })
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
