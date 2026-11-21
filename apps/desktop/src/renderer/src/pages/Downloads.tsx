import type { DownloadLibraryEntry, DownloadLibrarySnapshot } from '@shared/download-library'
import { emptyMixedOptions, type MixedEntry } from '@shared/mixed-download'
import { ExternalLink, FolderOpen } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DownloadFolderControl } from '../components/download/workspace/DownloadFolderControl'
import { ItemPreview } from '../components/download/workspace/ItemPreview'
import { ipcServices } from '../lib/ipc'
import '../components/download/workspace/workspace.css'

function LibraryRow({ row }: { row: DownloadLibraryEntry }) {
  const { t } = useTranslation()
  const [error, setError] = useState('')
  const entry: MixedEntry = {
    id: row.id,
    title: row.title,
    sourceUrl: row.sourceUrl,
    kind: row.kind,
    status: 'completed',
    selected: false,
    progress: row.progress,
    filePath: row.filePath,
    options: { ...emptyMixedOptions(), output: row.kind },
    info: { id: row.id, title: row.title, formats: [], thumbnail: row.thumbnail },
    image:
      row.kind === 'image'
        ? { url: row.thumbnail || row.sourceUrl, title: row.title, variants: [] }
        : undefined
  }
  const fileAction = async (open: boolean) => {
    if (!row.filePath) {
      return
    }
    setError('')
    try {
      const result = open
        ? await ipcServices.fs.openFile(row.filePath)
        : await ipcServices.fs.openFileLocation(row.filePath)
      if (!result) {
        setError(t('library.fileUnavailable'))
      }
    } catch (reason) {
      setError(String(reason))
    }
  }
  return (
    <article
      className="beast-media-card flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-card p-4"
      data-media-kind={row.kind}
      data-ui="library-item"
    >
      <ItemPreview entry={entry} />
      <div className="min-w-0 flex-1">
        <h2 className="line-clamp-2 font-semibold text-sm">{row.title}</h2>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          <strong className={`beast-status beast-status-${row.status}`}>{row.status}</strong>
          <span className="text-muted-foreground uppercase">{row.kind}</span>
          {row.createdAt > 0 && (
            <time className="text-muted-foreground">
              {new Date(row.createdAt).toLocaleString()}
            </time>
          )}
        </div>
        {row.filePath && (
          <p className="mt-1 truncate text-muted-foreground text-xs" title={row.filePath}>
            {row.filePath}
          </p>
        )}
        {['running', 'downloading', 'queued'].includes(row.status) && (
          <progress
            aria-label={row.title}
            className="mt-2 h-1 w-full"
            max={100}
            value={row.progress}
          />
        )}
        {(error || row.error) && (
          <p className="mt-1 text-destructive text-xs" role="alert">
            {error || row.error}
          </p>
        )}
      </div>
      {row.filePath && (
        <div className="flex gap-2">
          <button
            className="rounded-lg border px-3 py-2 text-xs"
            onClick={() => void fileAction(true)}
            type="button"
          >
            <ExternalLink className="mr-1 inline h-4 w-4" />
            {t('library.openFile')}
          </button>
          <button
            className="rounded-lg border px-3 py-2 text-xs"
            onClick={() => void fileAction(false)}
            type="button"
          >
            <FolderOpen className="mr-1 inline h-4 w-4" />
            {t('batch.showFile')}
          </button>
        </div>
      )}
    </article>
  )
}

export function Downloads() {
  const { t } = useTranslation()
  const [kind, setKind] = useState('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [snapshot, setSnapshot] = useState<DownloadLibrarySnapshot>()
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      try {
        const result = await ipcServices.batch.library(page, kind, query)
        if (active) {
          setSnapshot(result)
          setError('')
        }
      } catch (reason) {
        if (active) {
          setError(String(reason))
        }
      } finally {
        if (active) {
          timer = setTimeout(() => void load(), 2000)
        }
      }
    }
    void load()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [page, kind, query])
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="beast-hero beast-header-row">
        <div>
          <h1>{t('library.title')}</h1>
          <p>{t('library.description')}</p>
        </div>
        <DownloadFolderControl />
      </header>
      <section
        aria-label={t('library.title')}
        className="beast-workspace min-h-0 w-full flex-1 space-y-5 overflow-y-auto p-6"
      >
        <div aria-label={t('library.categories')} className="flex flex-wrap gap-2" role="tablist">
          {['all', 'video', 'image', 'audio'].map((value) => (
            <button
              aria-selected={kind === value}
              className={`rounded-full border px-4 py-2 text-sm ${kind === value ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card'}`}
              key={value}
              onClick={() => {
                setKind(value)
                setPage(0)
              }}
              role="tab"
              type="button"
            >
              {t(`library.${value}`)}{' '}
              <span className="ml-1 opacity-75">
                {snapshot?.counts[value as keyof DownloadLibrarySnapshot['counts']] || 0}
              </span>
            </button>
          ))}
        </div>
        <input
          aria-label={t('library.search')}
          className="beast-field"
          onChange={(event) => {
            setQuery(event.target.value)
            setPage(0)
          }}
          placeholder={t('library.search')}
          value={query}
        />
        {error && (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}
        {!(snapshot || error) && <p role="status">{t('workspace.loading')}</p>}
        {snapshot?.items.map((row) => (
          <LibraryRow key={row.id} row={row} />
        ))}
        {snapshot && !snapshot.items.length && (
          <p className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
            {t('library.empty')}
          </p>
        )}
        {snapshot && snapshot.pages > 1 && (
          <div className="flex items-center justify-between">
            <button
              disabled={snapshot.page === 0}
              onClick={() => setPage(Math.max(0, snapshot.page - 1))}
              type="button"
            >
              {t('library.previous')}
            </button>
            <span>
              {snapshot.page + 1} / {snapshot.pages}
            </span>
            <button
              disabled={snapshot.page + 1 >= snapshot.pages}
              onClick={() => setPage(snapshot.page + 1)}
              type="button"
            >
              {t('library.next')}
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
