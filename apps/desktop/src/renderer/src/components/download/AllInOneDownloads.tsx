import {
  audioFormats,
  type BatchBulkOptions,
  type BatchSnapshot,
  type MixedBatchAction,
  type MixedEntry,
  type MixedOptions,
  videoFormats
} from '@shared/mixed-download'
import { ChevronDown } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ItemPreview } from './workspace/ItemPreview'
import { TrimRangeEditor } from './workspace/TrimRangeEditor'
import './workspace/workspace.css'
import { ipcEvents, ipcServices } from '../../lib/ipc'

function BatchField({
  id,
  value,
  label,
  placeholder,
  commit
}: {
  id: string
  value: string
  label: string
  placeholder: string
  commit: (value: string) => Promise<boolean>
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <input
      aria-label={label}
      className="beast-field block w-full"
      id={id}
      onBlur={async () => {
        if (draft !== value && !(await commit(draft))) {
          setDraft(value)
        }
      }}
      onChange={(event) => setDraft(event.target.value)}
      placeholder={placeholder}
      value={draft}
    />
  )
}

export function BatchRow({
  entry,
  command
}: {
  entry: MixedEntry
  command: (action: MixedBatchAction, body?: Record<string, unknown>) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const editable = ['pending', 'ready', 'failed', 'cancelled'].includes(entry.status)
  const patch = (value: Partial<MixedOptions>) => command('patch', { id: entry.id, patch: value })
  const videos = videoFormats(entry.info),
    audios = audioFormats(entry.info)
  const active = ['fetching', 'queued', 'downloading', 'paused'].includes(entry.status)
  return (
    <article
      className="beast-media-card rounded-2xl border border-border bg-card p-4"
      data-media-kind={entry.kind}
      data-ui="media-card"
    >
      <details className="beast-item-details" data-ui="item-details">
        <summary
          aria-label={`${entry.title}: ${t('workspace.itemOptions')}`}
          className="beast-item-summary flex items-center gap-4"
        >
          <input
            aria-label={`Select ${entry.title}`}
            checked={entry.selected}
            className="shrink-0"
            onChange={(event) =>
              void command('select', { ids: [entry.id], selected: event.target.checked })
            }
            onClick={(event) => event.stopPropagation()}
            type="checkbox"
          />
          <ItemPreview entry={entry} />
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-2 font-semibold text-base" title={entry.title}>
              {entry.title}
            </h3>
            <p
              className="beast-row-url truncate text-muted-foreground text-xs"
              title={entry.sourceUrl}
            >
              {entry.sourceUrl}
            </p>
            <div className="mt-1 flex flex-wrap gap-2 text-xs">
              <span className="uppercase">{entry.kind}</span>
              <strong className={`beast-status beast-status-${entry.status}`}>
                {entry.status}
              </strong>
              {entry.info?.duration ? <span>{Math.round(entry.info.duration)}s</span> : null}
              {entry.status === 'downloading' && entry.progress > 0 ? (
                <span>{Math.round(entry.progress)}%</span>
              ) : null}
            </div>
            {entry.status === 'downloading' && entry.progress > 0 && (
              <progress className="mt-2 h-1 w-full" max={100} value={entry.progress} />
            )}
            {entry.error && (
              <p className="beast-row-extra mt-2 break-words text-destructive text-xs" role="alert">
                {entry.error}
              </p>
            )}
            {entry.filePath && (
              <p
                className="beast-row-extra mt-1 truncate text-muted-foreground text-xs"
                title={entry.filePath}
              >
                {entry.filePath}
              </p>
            )}
          </div>
          <ChevronDown
            aria-hidden="true"
            className="beast-expand-icon h-5 w-5 shrink-0 text-muted-foreground"
          />
        </summary>
        <div className="beast-item-options space-y-4" data-ui="item-options">
          {editable && !(entry.info || entry.image) && (
            <label className="block text-xs">
              Detect as{' '}
              <select
                className="beast-field ml-2"
                onChange={(event) =>
                  void command('patch', { id: entry.id, patch: { kind: event.target.value } })
                }
                value={entry.kind}
              >
                {['auto', 'video', 'audio', 'image'].map((kind) => (
                  <option key={kind}>{kind}</option>
                ))}
              </select>
            </label>
          )}
          {(entry.info || entry.image) && (
            <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" disabled={!editable}>
              {entry.kind === 'image' && entry.image ? (
                <>
                  <label className="space-y-1 text-xs">
                    Image size
                    <select
                      aria-label="Image size"
                      className="beast-field block w-full"
                      onChange={(event) => patch({ imageUrl: event.target.value })}
                      value={entry.options.imageUrl}
                    >
                      {[{ url: entry.image.url, width: entry.image.width }, ...entry.image.variants]
                        .filter((v, i, a) => a.findIndex((other) => other.url === v.url) === i)
                        .sort((a, b) => (b.width || 0) - (a.width || 0))
                        .map((v) => (
                          <option key={v.url} value={v.url}>
                            {v.width ? `${v.width}px wide` : 'Original source size'}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-xs">
                    Image output
                    <select
                      aria-label="Image output"
                      className="beast-field block w-full"
                      onChange={(event) =>
                        patch({ imageOutput: event.target.value as MixedOptions['imageOutput'] })
                      }
                      value={entry.options.imageOutput}
                    >
                      {['original', 'png', 'jpeg', 'webp'].map((format) => (
                        <option key={format}>{format}</option>
                      ))}
                    </select>
                  </label>
                </>
              ) : (
                <>
                  <label className="space-y-1 text-xs">
                    Save as
                    <select
                      aria-label="Media output"
                      className="beast-field block w-full"
                      onChange={(event) =>
                        patch({ output: event.target.value as 'video' | 'audio' })
                      }
                      value={entry.options.output}
                    >
                      <option disabled={!videos.length} value="video">
                        Video
                      </option>
                      <option disabled={!audios.length} value="audio">
                        Audio only
                      </option>
                    </select>
                  </label>
                  {entry.options.output === 'video' ? (
                    <>
                      <label className="space-y-1 text-xs">
                        Resolution
                        <select
                          aria-label="Video resolution"
                          className="beast-field block w-full"
                          onChange={(event) => patch({ videoFormat: event.target.value })}
                          value={entry.options.videoFormat}
                        >
                          {videos.map((f) => (
                            <option key={f.format_id} value={f.format_id}>
                              {f.width && f.height
                                ? `${f.width}×${f.height}`
                                : f.height
                                  ? `${f.height}p`
                                  : 'Original resolution'}{' '}
                              · {f.ext}
                              {f.fps ? ` · ${f.fps} fps` : ''}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-1 text-xs">
                        Container
                        <select
                          aria-label="Video container"
                          className="beast-field block w-full"
                          onChange={(event) =>
                            patch({ container: event.target.value as MixedOptions['container'] })
                          }
                          value={entry.options.container}
                        >
                          {['auto', 'mp4', 'mkv', 'webm'].map((format) => (
                            <option key={format}>{format}</option>
                          ))}
                        </select>
                      </label>
                    </>
                  ) : (
                    <>
                      <label className="space-y-1 text-xs">
                        Audio format
                        <select
                          aria-label="Audio format"
                          className="beast-field block w-full"
                          onChange={(event) => patch({ audioOutput: event.target.value })}
                          value={entry.options.audioOutput}
                        >
                          {['mp3', 'm4a', 'wav', 'flac', 'opus', 'ogg'].map((format) => (
                            <option key={format}>{format}</option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-1 text-xs">
                        Bitrate
                        <select
                          aria-label="Audio bitrate"
                          className="beast-field block w-full"
                          disabled={['wav', 'flac'].includes(entry.options.audioOutput)}
                          onChange={(event) => patch({ audioBitrate: Number(event.target.value) })}
                          value={entry.options.audioBitrate}
                        >
                          {[0, 128, 192, 256, 320].map((rate) => (
                            <option key={rate} value={rate}>
                              {rate ? `${rate} kbps` : 'Best available'}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  )}
                  <label className="space-y-1 text-xs">
                    Audio language / track
                    <select
                      aria-label="Audio track"
                      className="beast-field block w-full"
                      disabled={!audios.length}
                      onChange={(event) => patch({ audioTrack: event.target.value })}
                      value={entry.options.audioTrack}
                    >
                      {!audios.length && <option value="">No advertised audio track</option>}
                      {audios.map((f) => (
                        <option key={f.format_id} value={f.format_id}>
                          {f.language || 'Source audio'} · {f.format_note || f.ext} · {f.format_id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <TrimRangeEditor commit={patch} entry={entry} />
                </>
              )}
              <label className="space-y-1 text-xs" htmlFor={`${entry.id}-folder`}>
                Download folder
                <BatchField
                  commit={(value) => patch({ folder: value })}
                  id={`${entry.id}-folder`}
                  label="Item download folder"
                  placeholder="Default download folder"
                  value={entry.options.folder}
                />
              </label>
            </fieldset>
          )}
          <div className="flex flex-wrap gap-2 text-xs">
            {editable && (
              <button
                className="rounded border px-3 py-1"
                onClick={() => void command('fetch', { ids: [entry.id] })}
                type="button"
              >
                {t('batch.fetchOne', { defaultValue: 'Fetch / refresh' })}
              </button>
            )}
            {['ready', 'failed', 'paused'].includes(entry.status) &&
              (entry.info || entry.image) && (
                <button
                  className="rounded bg-primary px-3 py-1 text-primary-foreground"
                  onClick={() => void command('start', { ids: [entry.id] })}
                  type="button"
                >
                  {t('batch.downloadOne', { defaultValue: 'Download this item' })}
                </button>
              )}
            {(entry.info || entry.image) && (
              <button
                className="rounded border px-3 py-1"
                onClick={() => void command('clone', { id: entry.id })}
                type="button"
              >
                {t('batch.duplicate', { defaultValue: 'Duplicate with other settings' })}
              </button>
            )}
            {active && !(entry.kind === 'image' && entry.status === 'downloading') && (
              <button
                className="rounded border px-3 py-1"
                onClick={() => void command('cancel', { ids: [entry.id] })}
                type="button"
              >
                {t('batch.cancel', { defaultValue: 'Cancel / skip' })}
              </button>
            )}
            {!active && (
              <button
                className="rounded border px-3 py-1"
                onClick={() => void command('remove', { ids: [entry.id] })}
                type="button"
              >
                {t('batch.remove', { defaultValue: 'Remove from list' })}
              </button>
            )}
            {entry.filePath && (
              <button
                className="rounded border px-3 py-1"
                onClick={() => {
                  if (entry.filePath) {
                    void ipcServices.fs.openFileLocation(entry.filePath)
                  }
                }}
                type="button"
              >
                {t('batch.showFile', { defaultValue: 'Show saved file' })}
              </button>
            )}
          </div>
        </div>
      </details>
    </article>
  )
}

export function AllInOneDownloads() {
  const { t } = useTranslation()
  const [text, setText] = useState(''),
    [message, setMessage] = useState('')
  const [snapshot, setSnapshot] = useState<BatchSnapshot | null>(null)
  const [page, setPage] = useState(0),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all')
  const [busy, setBusy] = useState(false)
  const [height, setHeight] = useState(''),
    [audioOutput, setAudioOutput] = useState(''),
    [bitrate, setBitrate] = useState(''),
    [imageOutput, setImageOutput] = useState(''),
    [output, setOutput] = useState(''),
    [folder, setFolder] = useState('')
  const refresh = useCallback(async () => {
    setSnapshot(await ipcServices.batch.snapshot(page, query, filter))
  }, [page, query, filter])
  useEffect(() => {
    let current = true
    const load = async () => {
      try {
        const result = await ipcServices.batch.snapshot(page, query, filter)
        if (current) {
          setSnapshot(result)
        }
      } catch (error) {
        if (current) {
          setMessage(error instanceof Error ? error.message : String(error))
        }
      }
    }
    void load()
    const timer = setInterval(() => void load(), 1000)
    return () => {
      current = false
      clearInterval(timer)
    }
  }, [page, query, filter])
  const command = useCallback(
    async (action: MixedBatchAction, body: Record<string, unknown> = {}) => {
      setBusy(true)
      try {
        const result = (await ipcServices.batch.execute(action, body)) as {
          queued?: number
          changed?: number
          errors?: string[]
        }
        if (result.queued !== undefined) {
          setMessage(`${result.queued} items queued. Pending links must be fetched first.`)
        } else if (result.changed !== undefined) {
          setMessage(
            `${result.changed} items updated.${result.errors?.length ? ` ${result.errors.length} could not use these settings: ${result.errors[0]}` : ''}`
          )
        }
        await refresh()
        return true
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error))
        return false
      } finally {
        setBusy(false)
      }
    },
    [refresh]
  )
  useEffect(() => {
    const receive = async () => {
      try {
        const scan = await ipcServices.images.consumeImported()
        if (scan) {
          await ipcServices.batch.execute('importImages', { scan })
          await refresh()
          setMessage('Browser images added to the same download list.')
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error))
      }
    }
    void receive()
    const subscription = ipcEvents.on('beast:images-imported', () => void receive())
    return () => ipcEvents.removeListener('beast:images-imported', subscription)
  }, [refresh])
  const fetchLinks = async () => {
    setBusy(true)
    try {
      if (text.trim()) {
        const result = (await ipcServices.batch.execute('add', { text })) as {
          added: number
          duplicates: number
          invalid: string[]
        }
        setMessage(
          `${result.added} added · ${result.duplicates} duplicates skipped · ${result.invalid.length} invalid links.`
        )
        setText(result.invalid.join('\n'))
      }
      await ipcServices.batch.execute('fetch')
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  const applyBulk = () => {
    const patch: BatchBulkOptions = {}
    if (height !== '') {
      patch.height = Number(height)
    }
    if (output) {
      patch.output = output as 'video' | 'audio'
    }
    if (audioOutput) {
      patch.audioOutput = audioOutput
    }
    if (bitrate !== '') {
      patch.audioBitrate = Number(bitrate)
    }
    if (imageOutput) {
      patch.imageOutput = imageOutput as MixedOptions['imageOutput']
    }
    if (folder) {
      patch.folder = folder
    }
    void command('bulk', { patch })
  }
  return (
    <section aria-label="All-in-one downloader" className="beast-workspace space-y-5 p-6">
      <h2 className="font-bold text-xl">
        {t('batch.title', { defaultValue: 'All-in-one downloader' })}
      </h2>
      <p className="text-muted-foreground text-sm">
        {t('batch.description', {
          defaultValue:
            'Paste image, audio and video links together. Fetch first, review each item, then download individually or apply settings to selected items.'
        })}
      </p>
      <textarea
        aria-label="Mixed media URLs"
        className="beast-field w-full resize-y"
        onChange={(event) => setText(event.target.value)}
        placeholder={'Paste links here, one per line. You can append more links to the same queue.'}
        rows={4}
        value={text}
      />
      <div className="flex flex-wrap items-center gap-2" data-ui="queue-actions">
        <button
          className="rounded-lg bg-primary px-4 py-2 text-primary-foreground"
          disabled={busy}
          onClick={() => void fetchLinks()}
          type="button"
        >
          {t('batch.fetch', { defaultValue: 'Fetch links / pending' })}
        </button>
        <label className="cursor-pointer rounded-lg border px-3 py-2 text-sm">
          {t('batch.importText', { defaultValue: 'Import .txt' })}
          <input
            accept=".txt,text/plain"
            aria-label="Import URL text file"
            className="sr-only"
            onChange={async (event) => {
              const file = event.target.files?.[0]
              if (file) {
                if (file.size > 2_000_000) {
                  setMessage('Import smaller text chunks; you can append them to the same queue.')
                } else {
                  setText(await file.text())
                }
              }
            }}
            type="file"
          />
        </label>
        <button
          className="rounded-lg border px-3 py-2 text-sm"
          disabled={busy}
          onClick={() => void command('select', { ids: 'all' })}
          type="button"
        >
          {t('batch.selectAll', { defaultValue: 'Select all' })}
        </button>
        <button
          className="rounded-lg border px-3 py-2 text-sm"
          disabled={busy}
          onClick={() => void command('select', { ids: 'none' })}
          type="button"
        >
          {t('batch.selectNone', { defaultValue: 'Select none' })}
        </button>
        <button
          className="rounded-lg bg-primary px-4 py-2 text-primary-foreground"
          disabled={busy || !snapshot?.downloadableSelected}
          onClick={() => void command('start')}
          type="button"
        >
          {t('batch.download', { defaultValue: 'Download selected' })} (
          {snapshot?.downloadableSelected || 0})
        </button>
        <button
          className="rounded-lg border px-3 py-2 text-sm"
          onClick={() => void command('pause', { paused: !snapshot?.paused })}
          type="button"
        >
          {snapshot?.paused ? 'Continue queue' : 'Pause new jobs'}
        </button>
        <button
          className="rounded-lg border px-3 py-2 text-sm"
          disabled={!snapshot?.counts.failed}
          onClick={() => void command('retry')}
          type="button"
        >
          {t('batch.retry', { defaultValue: 'Retry selected failures' })}
        </button>
        <button
          className="rounded-lg border px-3 py-2 text-sm"
          disabled={!snapshot?.selected}
          onClick={() => void command('cancel')}
          title="Stops selected queued and media jobs. An image already being written finishes safely."
          type="button"
        >
          {t('batch.cancelSelected', { defaultValue: 'Cancel selected' })}
        </button>
        <button
          className="rounded-lg border px-3 py-2 text-sm"
          onClick={() => void command('remove', { finished: true })}
          type="button"
        >
          {t('batch.clearFinished', { defaultValue: 'Clear finished rows' })}
        </button>
      </div>
      <details className="rounded-xl border border-border p-4" data-ui="bulk-settings">
        <summary className="cursor-pointer font-semibold text-sm">
          {t('batch.bulk', { defaultValue: 'Bulk settings for selected, fetched items' })}
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-xs">
            Media output
            <select
              className="beast-field mt-1 block w-full"
              onChange={(e) => setOutput(e.target.value)}
              value={output}
            >
              <option value="">Keep each type</option>
              <option value="video">Video where available</option>
              <option value="audio">Audio only where available</option>
            </select>
          </label>
          <label className="text-xs">
            Maximum video height
            <select
              className="beast-field mt-1 block w-full"
              onChange={(e) => setHeight(e.target.value)}
              value={height}
            >
              <option value="">Keep each resolution</option>
              {[0, 240, 360, 480, 540, 720, 1080, 1440, 2160, 4320].map((h) => (
                <option key={h} value={h}>
                  {h ? `${h}p` : 'Highest source quality'}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            Audio format
            <select
              className="beast-field mt-1 block w-full"
              onChange={(e) => setAudioOutput(e.target.value)}
              value={audioOutput}
            >
              <option value="">Keep each format</option>
              {['mp3', 'm4a', 'wav', 'flac', 'opus', 'ogg'].map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            Audio bitrate
            <select
              className="beast-field mt-1 block w-full"
              onChange={(e) => setBitrate(e.target.value)}
              value={bitrate}
            >
              <option value="">Keep each bitrate</option>
              {[0, 128, 192, 256, 320].map((b) => (
                <option key={b} value={b}>
                  {b ? `${b} kbps` : 'Best'}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            Image format
            <select
              className="beast-field mt-1 block w-full"
              onChange={(e) => setImageOutput(e.target.value)}
              value={imageOutput}
            >
              <option value="">Keep each image format</option>
              {['original', 'png', 'jpeg', 'webp'].map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            Folder for selected items
            <div className="mt-1 flex gap-2">
              <input
                className="beast-field min-w-0 flex-1"
                onChange={(e) => setFolder(e.target.value)}
                placeholder="Leave folders unchanged"
                value={folder}
              />
              <button
                className="rounded border px-2"
                onClick={async () => {
                  const picked = await ipcServices.fs.selectDirectory()
                  if (picked) {
                    setFolder(picked)
                  }
                }}
                type="button"
              >
                Browse
              </button>
            </div>
          </label>
        </div>
        <p className="mt-2 text-muted-foreground text-xs">
          Resolution uses the best advertised source at or below the chosen height, or the smallest
          source if none is lower. Images are never enlarged. Review each row before downloading.
        </p>
        <button
          className="mt-3 rounded-lg bg-primary px-4 py-2 text-primary-foreground text-sm"
          disabled={busy}
          onClick={applyBulk}
          type="button"
        >
          {t('batch.apply', { defaultValue: 'Apply to selected' })}
        </button>
      </details>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <strong>{snapshot?.total || 0} total</strong>
        <span>{snapshot?.counts.ready || 0} ready</span>
        <span>
          {(snapshot?.counts.downloading || 0) + (snapshot?.counts.queued || 0)} active / queued
        </span>
        <span>{snapshot?.counts.completed || 0} completed</span>
        <span>{snapshot?.counts.failed || 0} failed</span>
        {snapshot?.fetching && <strong>Fetching…</strong>}
        {snapshot?.paused && <strong>New jobs paused; current downloads continue.</strong>}
        <label>
          Concurrent jobs{' '}
          <select
            className="beast-field ml-1"
            onChange={(e) => void command('concurrency', { count: Number(e.target.value) })}
            value={snapshot?.concurrency || 3}
          >
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="break-words text-sm" role="status">
        {message}
      </p>
      {snapshot?.storageError && (
        <p className="text-destructive text-sm" role="alert">
          {snapshot.storageError}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]" data-ui="queue-filters">
        <input
          aria-label="Search batch"
          className="beast-field min-w-0 flex-1"
          onChange={(e) => {
            setQuery(e.target.value)
            setPage(0)
          }}
          placeholder="Search title or URL"
          value={query}
        />
        <select
          aria-label="Filter batch"
          className="beast-field"
          onChange={(e) => {
            setFilter(e.target.value)
            setPage(0)
          }}
          value={filter}
        >
          {[
            'all',
            'image',
            'audio',
            'video',
            'pending',
            'fetching',
            'ready',
            'queued',
            'downloading',
            'paused',
            'completed',
            'failed',
            'cancelled'
          ].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </div>
      <div className="space-y-3">
        {snapshot?.items.map((entry) => (
          <BatchRow command={command} entry={entry} key={entry.id} />
        ))}
      </div>
      {!snapshot?.total && (
        <p className="rounded-xl border border-dashed p-6 text-muted-foreground text-sm">
          {t('batch.empty', {
            defaultValue:
              'Add a few links or a large mixed batch. Your choices and results are saved automatically.'
          })}
        </p>
      )}
      {!!snapshot?.total && (
        <div className="flex items-center justify-between gap-3 text-sm">
          <button
            disabled={!snapshot.page}
            onClick={() => setPage(Math.max(0, (snapshot?.page || 0) - 1))}
            type="button"
          >
            Previous
          </button>
          <span>
            {snapshot.filtered} matching · page {snapshot.page + 1} / {snapshot.pages}
          </span>
          <button
            disabled={snapshot.page + 1 >= snapshot.pages}
            onClick={() => setPage(snapshot.page + 1)}
            type="button"
          >
            Next
          </button>
        </div>
      )}
      <p className="text-muted-foreground text-xs">
        Large batches are queued in this same workspace. Image writes run one at a time alongside
        media jobs. Browser-only or signed-in pages can send selected images here from the
        extension. Clearing rows never deletes saved files.
      </p>
    </section>
  )
}
