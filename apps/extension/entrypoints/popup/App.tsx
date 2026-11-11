import { useEffect, useState } from 'react'
import {
  appRequest,
  appHealth,
  language,
  publicUrl,
  type Format,
  type Info,
  type Media
} from '../../lib/media'
import { imageBlob, makeZip, safeName, saveBlob, scanPage } from '../../lib/images'
import './App.css'
export default function App() {
  const [tabId, setTabId] = useState<number>(),
    [url, setUrl] = useState(''),
    [mode, setMode] = useState('video')
  const [media, setMedia] = useState<Media[]>([]),
    [info, setInfo] = useState<Info>(),
    [videoId, setVideo] = useState(''),
    [audioId, setAudio] = useState('')
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [bitrate, setBitrate] = useState('320'),
    [clip, setClip] = useState(false),
    [start, setStart] = useState('0'),
    [end, setEnd] = useState('10')
  const [selected, setSelected] = useState<string[]>([]),
    [minWidth, setMinWidth] = useState(0),
    [fileType, setFileType] = useState('all'),
    [output, setOutput] = useState('png'),
    [zip, setZip] = useState(true),
    [template, setTemplate] = useState('{date}-{name}')
  const [downloadSubs, setDownloadSubs] = useState(false)
  const [failed, setFailed] = useState<string[]>([])
  const [floating, setFloating] = useState(false)
  const [editorMp4, setEditorMp4] = useState(true)
  const [forceMp3, setForceMp3] = useState(true)
  const [embedAudioCover, setEmbedAudioCover] = useState(true)
  const [elapsed, setElapsed] = useState(0)
  const [errorState, setErrorState] = useState(false)
  const [highest, setHighest] = useState(true)
  const [imageVariant, setImageVariant] = useState<Record<string,string>>({})
  const [health, setHealth] = useState('App connection not checked yet.')
  useEffect(() => {
    if (!busy) return
    setElapsed(0)
    void browser.storage.local.set({ busyUntil: Date.now()+120000 })
    const timer = setInterval(()=>{ setElapsed(v=>v+1); void browser.storage.local.set({busyUntil:Date.now()+120000}) },1000)
    return ()=>clearInterval(timer)
  },[busy])
  const showInfo = (result: Info) => {
    setInfo(result)
    const videos = result.formats.filter((f) => f.vcodec && f.vcodec !== 'none' && (!f.height || f.height <= 2160)).sort((a, b) => (b.height || 0) - (a.height || 0) || Number(b.protocol === 'https') - Number(a.protocol === 'https'))
    const audios = audioFormats(result)
    setVideo((videos.find((f) => f.height === 1080) || videos[0])?.format_id || '')
    setAudio((audios.find((f) => /original/i.test(f.format_note || '')) || audios[0])?.format_id || (videos.length ? 'none' : ''))
    setEnd(String(Math.min(result.duration || 10, 10)))
    setMessage('Choose the source quality and audio language below.')
  }
  useEffect(() => {
    void (async () => {
      try {
        const param = new URLSearchParams(location.search)
        const settings = await browser.storage.local.get('floatingButtons')
        setFloating(settings.floatingButtons === true)
        const id = Number(param.get('tab'))
        const tab = id
          ? await browser.tabs.get(id)
          : (await browser.tabs.query({ active: true, currentWindow: true }))[0]
        setTabId(tab?.id)
        if (param.get('unresolved') === '1') {
          setErrorState(true)
          setMessage('The clicked media has no readable link yet. Open that individual post/reel, play it, and click Download again. A feed/homepage is not a video URL. You can also enable network detection and Rescan.')
          return
        }
        const target = param.get('target') || tab?.url || ''
        if (publicUrl(target)) {
          setUrl(target)
          if (param.get('kind') === 'audio') setMode('audio')
          if (param.get('kind') === 'image') {
            setMode('images')
            let variants: {url:string; width?:number}[] = []
            try { const parsed = JSON.parse(param.get('variants') || '[]'); if (Array.isArray(parsed)) variants=parsed.filter(v=>publicUrl(v?.url)).slice(0,20) } catch { /* Ignore invalid page hints. */ }
            setMedia([{ url: target, kind: 'image', variants }])
            setSelected([target])
          } else if (param.get('auto') === '1') {
            setBusy(true)
            setMessage('Reading available qualities and audio languages…')
            try { showInfo(await appRequest('/beast/info', { url: target }, setMessage)) }
            catch (error) { setErrorState(true); setMessage(error instanceof Error ? error.message : 'Could not analyze this media. Try the page URL or enable network detection.') }
            finally { setBusy(false) }
          }
        } else setMessage('Open a public website first.')
      } catch {
        setMessage('The source tab has closed. Open this extension from the website again.')
      }
    })()
  }, [])
  const run = async (job: () => Promise<void>) => {
    setBusy(true)
    setErrorState(false)
    setMessage('Working…')
    try {
      await job()
    } catch (e) {
      setErrorState(true)
      setMessage(e instanceof Error ? e.message : 'Operation failed.')
    } finally {
      setBusy(false)
    }
  }
  const scan = () =>
    run(async () => {
      if (tabId === undefined) throw new Error('No source tab.')
      setMessage('Fetching images and media from this page…')
      const found = await scanPage(tabId)
      const captured: Media[] = await browser.runtime.sendMessage({ type: 'captured', tabId })
      const all = [...found, ...captured]
      setMedia(all.filter((m, i) => all.findIndex((x) => x.url === m.url) === i))
      setMessage(all.length ? `Scan complete: ${all.length} source(s) found. Scroll or play media, then Rescan for more.` : 'No readable media found. Open the individual post, play the video or scroll images into view, then retry.')
    })
  const analyze = () =>
    run(async () => {
      setInfo(undefined)
      const result = await appRequest('/beast/info', { url }, setMessage)
      showInfo(result)
    })
  const toggleFloating = () => void run(async () => {
    if (!floating) {
      const granted = await browser.permissions.request({ origins: ['http://*/*', 'https://*/*'] })
      if (!granted) throw new Error('Website access is needed to show download buttons. Right-click remains available.')
    }
    await browser.runtime.sendMessage({ type: 'overlay', enabled: !floating })
    setFloating(!floating)
    setMessage(floating ? 'Floating download buttons are off.' : 'Floating buttons enabled. Video/audio buttons appear on visible players; hover over an image for its button. Reload a page if needed.')
  })
  const capture = () => {
    void run(async () => {
      setMessage('Approve website access in your browser to continue.')
      const granted = await browser.permissions.request({ origins: ['http://*/*', 'https://*/*'] })
      if (!granted) throw new Error('Permission was not granted. Page scan remains available.')
      await browser.runtime.sendMessage({ type: 'capture', tabId })
      setMessage(
        'Detection armed for this tab. Play the media, then Rescan. Site permission can be revoked below.'
      )
    })
  }
  const revoke = () =>
    run(async () => {
      const granted = await browser.permissions.getAll()
      await browser.runtime.sendMessage({ type: 'overlay', enabled: false })
      setFloating(false)
      await browser.permissions.remove({
        origins: (granted.origins || []).filter((o) => o !== 'http://127.0.0.1/*')
      })
      await browser.runtime.sendMessage({ type: 'clear', tabId })
      setMedia([])
      setInfo(undefined)
      setMessage('Optional website access revoked and this tab’s capture cleared.')
    })
  const download = () =>
    run(async () => {
      if (!info) throw new Error('Analyze first.')
      const result = await appRequest('/beast/download', {
        ticket: info.ticket,
        videoId,
        audioId,
        type: mode === 'audio' ? 'audio' : 'video',
        bitrate: mode === 'audio' && forceMp3 ? Number(bitrate) || 320 : 0,
        embedAudioCover: mode === 'audio' && embedAudioCover,
        editorCompatible: mode === 'video' && editorMp4,
        downloadSubs,
        start: clip ? Number(start) : 0,
        end: clip ? Number(end) : 0
      })
      if (result.queued) {
        setMessage('Added to Beast Downloader. Progress, pause and retry are in the desktop app.')
        setInfo(undefined)
      }
    })
  const images = media.filter(
    (m) =>
      m.kind === 'image' &&
      (!minWidth || (m.width || 0) >= minWidth) &&
      (fileType === 'all' || new URL(m.url).pathname.toLowerCase().endsWith('.' + fileType))
  )
  const saveImages = (retry = false) => {
    const urls = retry ? failed : selected.filter((u) => images.some((m) => m.url === u))
    void run(async () => {
      if (!urls.length) throw new Error('Select at least one image.')
      if (urls.length > 100) throw new Error('Select up to 100 images per batch.')
      const choices = (url:string) => {
        const variants = images.find(m=>m.url===url)?.variants || []
        const preferred = imageVariant[url] ? [imageVariant[url]] : highest ? [...variants].sort((a,b)=>(b.width||0)-(a.width||0)).map(v=>v.url) : []
        return [...new Set([...preferred,url])].filter(publicUrl)
      }
      const origins = [...new Set(urls.flatMap(choices).map((u) => new URL(u).origin + '/*'))]
      setMessage('Approve image-host access in your browser to continue.')
      const allowed = await browser.permissions.request({ origins })
      if (!allowed) throw new Error('Image-host permission was not granted.')
      const files: { name: string; blob: Blob }[] = []
      const errors: string[] = []
      let total = 0,
        success = 0, fallback = 0
      const failures: string[] = []
      for (const [i, target] of urls.entries()) {
        setMessage(`Saving image ${i + 1} of ${urls.length}…`)
        try {
          let blob: Blob | undefined
          let lastError: unknown
          const candidates = choices(target)
          for (const candidate of candidates) {
            try { blob = await imageBlob(candidate, output); if (candidate !== candidates[0]) fallback++; break }
            catch (error) { lastError = error }
          }
          if (!blob) throw lastError || new Error('No available image source could be saved.')
          total += blob.size
          if (total > 100 * 1024 * 1024) throw new Error('Batch exceeds 100 MB.')
          const host = new URL(target).hostname
          const base = safeName(
            decodeURIComponent(new URL(target).pathname.split('/').pop() || 'image').replace(
              /\.[^.]+$/,
              ''
            )
          )
          const name =
            safeName(
              template
                .replaceAll('{name}', base)
                .replaceAll('{domain}', host)
                .replaceAll('{date}', new Date().toISOString().slice(0, 10))
            ) +
            '-' +
            (i + 1) +
            '.' +
            (blob.type.split('/')[1] === 'jpeg' ? 'jpg' : blob.type.split('/')[1])
          if (zip) files.push({ name, blob })
          else await saveBlob(blob, 'Beast Images/' + name)
          success++
        } catch (error) {
          errors.push(target)
          failures.push(error instanceof Error ? error.message : 'Image failed.')
        }
      }
      if (zip && files.length) {
        try {
          await saveBlob(await makeZip(files), 'Beast Images/images-' + Date.now() + '.zip')
        } catch (error) {
          setFailed(urls)
          throw error
        }
      }
      setFailed(errors)
      setMessage(
        `${success} image(s) saved. ${fallback} used an available fallback size. ${errors.length} failed. ${failures[0] || ''} Images use browser Downloads; video/audio use Beast’s folder.`
      )
    })
  }
  return (
    <main>
      <header>
        <div>
          <h1>Beast</h1>
          <p>Browser companion · 1.3.3</p>
        </div>
        <button
          type="button"
          onClick={() =>
            void browser.tabs.create({
              url: browser.runtime.getURL('/popup.html') + '?tab=' + tabId
            })
          }
        >
          Open full view
        </button>
      </header>
      <nav>
        {['video', 'audio', 'images'].map((x) => (
          <button type="button" aria-pressed={mode === x} key={x} onClick={() => setMode(x)}>
            {x[0].toUpperCase() + x.slice(1)}
          </button>
        ))}
      </nav>
      <p className="hint">
        Use full view for long jobs. Closing this panel can interrupt image processing.
      </p>
      <p role="status">{health}</p>
      <div className="row">
        <button type="button" disabled={busy} onClick={()=>void run(async()=>{const status=await appHealth();setHealth(`Connected to Beast ${status.appVersion || ''}. Companion ${browser.runtime.getManifest().version}.`);setMessage('Connection is working. Analyze a media URL next.');await browser.runtime.sendMessage({type:'check-update'})})}>Check app connection / sync</button>
        <button type="button" disabled={busy} onClick={()=>browser.runtime.reload()}>Reload extension</button>
      </div>
      <p className="hint">After app updates, this companion checks for synced files while idle. If buttons stop responding, refresh the website. Use Reload extension if needed. An ! badge means the desktop app was unreachable; UP means the extension folder needs updating.</p>
      <div className="row">
        <button type="button" disabled={busy} aria-pressed={floating} onClick={toggleFloating}>
          {floating ? 'Turn off floating download buttons' : 'Enable floating download buttons'}
        </button>
        <button type="button" disabled={busy} onClick={scan}>
          Rescan page
        </button>
        <button type="button" disabled={busy} onClick={capture}>
          Enable network media detection
        </button>
      </div>
      <details>
        <summary>Permissions & privacy</summary>
        <p>
          Floating buttons inspect visible media on permitted pages after you enable them. Clicking a button opens quality options; it does not start a download. You can also right-click an image, video or audio element. Page scans run on your click. Network detection requests website access and records media
          addresses only for tabs you arm. No cookies, passwords or telemetry are collected by this
          extension. Detection data stays in memory. DRM media is unsupported.
        </p>
        <button type="button" disabled={busy} onClick={revoke}>
          Revoke website access & clear capture
        </button>
      </details>
      {busy && <div role="status" className="status"><progress aria-label="Fetching or processing media" /> <span>{elapsed}s — {message}</span><p>Keep this view open. Website lookup may take up to 100 seconds.</p></div>}
      {message && !busy && (
        <p role={errorState ? 'alert' : 'status'} className="status">
          {message}
        </p>
      )}
      {mode !== 'images' ? (
        <section>
          <label><input type="checkbox" checked={mode === 'video' ? editorMp4 : forceMp3} onChange={e=>mode === 'video' ? setEditorMp4(e.target.checked) : setForceMp3(e.target.checked)} /> {mode === 'video' ? 'Editing-compatible MP4 (H.264 video + AAC audio)' : 'Convert to MP3'}</label>
          <p className="hint">{mode === 'video' ? 'MP4 conversion uses 8-bit H.264, 30 fps and 48 kHz stereo AAC. It takes extra time and retains the original file. HDR and frame rate may change; no upscaling. Editor support still depends on its version.' : 'MP3 uses the bitrate below. Untick to keep the source audio. Higher bitrate does not restore missing source detail.'}</p>
          {mode === 'audio' && <label><input type="checkbox" checked={embedAudioCover} onChange={e=>setEmbedAudioCover(e.target.checked)} /> Use video thumbnail as audio cover</label>}
          <label>
            Page or detected media URL
            <input
              aria-label="Media URL"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                setInfo(undefined)
              }}
            />
          </label>
          <select
            aria-label="Detected media"
            value=""
            onChange={(e) => {
              setUrl(e.target.value)
              setInfo(undefined)
            }}
          >
            <option value="">
              Choose detected media ({media.filter((m) => m.kind !== 'image').length})
            </option>
            {media
              .filter((m) => m.kind !== 'image')
              .map((m, i) => (
                <option value={m.url} key={m.url}>
                  {m.kind} {i + 1} · {new URL(m.url).hostname}
                </option>
              ))}
          </select>
          <button
            className="primary"
            type="button"
            disabled={busy || !publicUrl(url)}
            onClick={analyze}
          >
            Analyze / Test connection
          </button>
          {info && (
            <>
              <h2>{info.title}</h2>
              {mode === 'video' && (
                <label>
                  Video quality
                  <select
                    aria-label="Video quality"
                    value={videoId}
                    onChange={(e) => setVideo(e.target.value)}
                  >
                    {info.formats
                      .filter(
                        (f) => f.vcodec && f.vcodec !== 'none' && (!f.height || f.height <= 2160)
                      )
                      .map((f) => (
                        <option key={f.format_id} value={f.format_id}>
                          {f.height || 'Source'}p · {f.ext} · {f.fps || '?'} fps · {f.vcodec} ·{' '}
                          {f.protocol === 'https' ? 'Direct' : 'Stream'}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <label>
                Audio language / dubbing
                <select
                  aria-label="Audio language"
                  value={audioId}
                  onChange={(e) => setAudio(e.target.value)}
                >
                  {mode === 'video' && !audioFormats(info).length && <option value="none">No audio track in this source</option>}
                  {audioFormats(info).map((f) => (
                    <option key={f.format_id} value={f.format_id}>
                      {language(f)}
                    </option>
                  ))}
                </select>
              </label>
              <p className="hint">
                Only tracks exposed by this source appear. If missing, change the website player’s
                language and Rescan. Your selected language is never silently replaced.
              </p>
              {mode === 'audio' && forceMp3 && (
                <label>
                  Audio bitrate
                  <select value={bitrate} onChange={(e) => setBitrate(e.target.value)}>
                    {[64, 96, 128, 160, 192, 256, 320].map((n) => (
                      <option key={n} value={n}>
                        {n ? n + ' kbps MP3' : 'Original source'}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={downloadSubs}
                  onChange={(e) => setDownloadSubs(e.target.checked)}
                />{' '}
                Include subtitles (uses desktop language settings; site limits may apply)
              </label>
              <label>
                <input type="checkbox" checked={clip} onChange={(e) => setClip(e.target.checked)} />{' '}
                Download selected part only
              </label>
              {clip && (
                <div className="row">
                  <label>
                    Start (seconds)
                    <input
                      type="number"
                      min="0"
                      value={start}
                      onChange={(e) => setStart(e.target.value)}
                    />
                  </label>
                  <label>
                    End (seconds)
                    <input
                      type="number"
                      min="0"
                      value={end}
                      onChange={(e) => setEnd(e.target.value)}
                    />
                  </label>
                </div>
              )}
              <button
                type="button"
                className="primary"
                disabled={busy || !audioId || (mode === 'video' && !videoId)}
                onClick={download}
              >
                Download with Beast
              </button>
            </>
          )}
        </section>
      ) : (
        <section>
          <h2>Images · {images.length} found</h2>
          <div className="row">{['png','jpeg','original','webp'].map(format=><label key={format}><input type="radio" name="image-output" checked={output===format} onChange={()=>setOutput(format)}/>{format.toUpperCase()}</label>)}</div>
          <label><input type="checkbox" checked={highest} onChange={e=>setHighest(e.target.checked)}/> Prefer highest size advertised by this page; fall back if unavailable</label>
          <div className="row">
            <label>
              Minimum width
              <input
                type="number"
                min="0"
                value={minWidth}
                onChange={(e) => setMinWidth(Number(e.target.value))}
              />
            </label>
            <label>
              Source type
              <select value={fileType} onChange={(e) => setFileType(e.target.value)}>
                {['all', 'png', 'jpg', 'webp', 'gif', 'avif'].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label>
              Save as
              <select value={output} onChange={(e) => setOutput(e.target.value)}>
                {['original', 'png', 'jpeg', 'webp'].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
          </div>
          <p className="hint">
            PNG/JPEG use broadly supported 8-bit output. Conversion flattens animation; JPEG uses white behind transparency. TIFF/HEIC/camera RAW conversion uses the running desktop app. Some camera variants or damaged files may fail. Only page-advertised sizes are tried; images are never enlarged artificially.
          </p>
          <label>
            Filename template
            <input
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              placeholder="{date}-{name}-{domain}"
            />
          </label>
          <div className="row">
            <button
              type="button"
              onClick={() => setSelected(images.slice(0, 100).map((m) => m.url))}
            >
              Select first 100 / all
            </button>
            <button type="button" onClick={() => setSelected([])}>
              Clear selection
            </button>
            <label>
              <input type="checkbox" checked={zip} onChange={(e) => setZip(e.target.checked)} /> ZIP
              archive
            </label>
          </div>
          <div className="gallery">
            {images.map((m) => (
              <label className="image" key={m.url}>
                <input
                  type="checkbox"
                  checked={selected.includes(m.url)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked ? [...selected, m.url] : selected.filter((u) => u !== m.url)
                    )
                  }
                />
                <img
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  src={m.url}
                  alt={m.title || 'Page image'}
                />
                <span>{m.width && m.height ? m.width + ' × ' + m.height : 'Size unknown'}</span>
                {!!m.variants?.length && <select aria-label={`Image size: ${m.title || m.url}`} value={imageVariant[m.url] || ''} onChange={e=>setImageVariant({...imageVariant,[m.url]:e.target.value})}><option value="">Automatic size</option><option value={m.url}>Displayed source</option>{m.variants.filter(v=>v.url!==m.url).map(v=><option key={v.url} value={v.url}>{v.width ? `${v.width}px` : 'Alternate size'}</option>)}</select>}
              </label>
            ))}
          </div>
          <button className="primary" type="button" disabled={busy} onClick={() => saveImages()}>
            Save selected images ({selected.filter((u) => images.some((m) => m.url === u)).length})
          </button>
          {failed.length > 0 && (
            <button type="button" disabled={busy} onClick={() => saveImages(true)}>
              Retry {failed.length} failed images
            </button>
          )}
        </section>
      )}
      <footer>
        Keep Beast Downloader open for video/audio. Reinstall this extension any time from the
        desktop Extensions page.
      </footer>
    </main>
  )
}
function audioFormats(info: Info): Format[] {
  const all = info.formats.filter((f) => f.acodec && f.acodec !== 'none')
  const separate = all.filter((f) => !f.vcodec || f.vcodec === 'none')
  return (separate.length ? separate : all).sort(
    (a, b) => (a.language || '').localeCompare(b.language || '') || (b.tbr || 0) - (a.tbr || 0)
  )
}
