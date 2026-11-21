import type { ImageOutput, ImageScan, ImageSource } from '@shared/image-download'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ipcServices } from '../../lib/ipc'

function ImageCard({
  image,
  checked,
  onSelect,
  chosen,
  onChoose
}: {
  image: ImageSource
  checked: boolean
  onSelect: () => void
  chosen: string
  onChoose: (url: string) => void
}) {
  const { t } = useTranslation()
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    setPreview(null)
    void ipcServices.images
      .preview(image.url)
      .then((value) => {
        if (current) {
          setPreview(value)
        }
      })
      .catch(() => {})
    return () => {
      current = false
    }
  }, [image.url])
  const variants = [{ url: image.url, width: image.width }, ...image.variants]
    .filter((item, index, all) => all.findIndex((other) => other.url === item.url) === index)
    .sort((a, b) => (b.width || 0) - (a.width || 0))
  return (
    <article className="space-y-2 rounded-xl border border-border p-3">
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          aria-label={`Select ${image.title || image.url}`}
          checked={checked}
          onChange={onSelect}
          type="checkbox"
        />
        <span className="truncate">{image.title || new URL(image.url).hostname}</span>
      </label>
      <div className="flex h-36 items-center justify-center overflow-hidden rounded-lg bg-muted">
        {preview ? (
          <img
            alt={image.title || 'Image preview'}
            className="h-full w-full object-contain"
            src={preview}
          />
        ) : (
          <span className="text-muted-foreground text-xs">
            {t('imageDownloads.previewUnavailable')}
          </span>
        )}
      </div>
      <p className="text-muted-foreground text-xs">
        {image.width && image.height
          ? `${image.width}×${image.height}`
          : t('imageDownloads.originalSize')}
      </p>
      <select
        aria-label={`Image size for ${image.title || image.url}`}
        className="beast-field w-full text-xs"
        onChange={(event) => onChoose(event.target.value)}
        value={chosen}
      >
        {variants.map((variant) => (
          <option key={variant.url} value={variant.url}>
            {variant.width ? `${variant.width}px` : t('imageDownloads.sourceSize')}
            {variant.url === image.url ? ` · ${t('imageDownloads.displayedSource')}` : ''}
          </option>
        ))}
      </select>
      <p className="truncate text-muted-foreground text-xs" title={chosen}>
        {chosen}
      </p>
    </article>
  )
}

export function ImageDownloads({ imported }: { imported?: ImageScan | null }) {
  const { t } = useTranslation()
  const [url, setUrl] = useState('')
  const [scan, setScan] = useState<ImageScan | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [output, setOutput] = useState<ImageOutput>('original')
  const [folder, setFolder] = useState('')
  const [minWidth, setMinWidth] = useState(0)
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState<{ url: string; title?: string }[]>([])
  const applyScan = useCallback((result: ImageScan) => {
    setScan(result)
    setUrl(result.pageUrl)
    setSelected([])
    setPage(0)
    setFailed([])
    setChoices(
      Object.fromEntries(
        result.images.map((image) => {
          const variants = [{ url: image.url, width: image.width }, ...image.variants].sort(
            (a, b) => (b.width || 0) - (a.width || 0)
          )
          return [image.url, variants[0].url]
        })
      )
    )
    setMessage(
      result.images.length
        ? `${result.images.length} images found. Choose the images and sizes to save.`
        : 'No images found in the page HTML. Open the page in Chrome and use Images → Send selected to Beast in the extension.'
    )
  }, [])
  useEffect(() => {
    if (imported) {
      applyScan(imported)
    }
  }, [imported, applyScan])
  const filtered = useMemo(
    () =>
      (scan?.images || []).filter(
        (image) =>
          !minWidth ||
          Math.max(image.width || 0, ...image.variants.map((variant) => variant.width || 0)) >=
            minWidth
      ),
    [scan, minWidth]
  )
  const shown = filtered.slice(page * 12, page * 12 + 12)
  const analyze = async () => {
    setScan(null)
    setSelected([])
    setBusy(true)
    setMessage('Reading image sources…')
    try {
      applyScan(await ipcServices.images.scan(url.trim()))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  const save = async (retry = false) => {
    const images = retry
      ? failed
      : (scan?.images || [])
          .filter((image) => selected.includes(image.url))
          .map((image) => ({ url: choices[image.url] || image.url, title: image.title }))
    if (!images.length) {
      setMessage('Select at least one image.')
      return
    }
    setBusy(true)
    setMessage(`Downloading ${images.length} image(s)…`)
    try {
      const result = await ipcServices.images.save({
        images,
        pageUrl: scan?.pageUrl,
        output,
        directory: folder || undefined
      })
      setFolder(result.directory)
      setFailed(result.failed)
      setMessage(
        `${result.saved.length} saved to ${result.directory}. ${result.failed.length} failed.${result.failed[0] ? ` ${result.failed[0].error}` : ''}`
      )
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-label="Image downloads" className="h-full space-y-4 overflow-y-auto p-5">
      <h2 className="font-semibold text-xl">{t('imageDownloads.title')}</h2>
      <p className="text-muted-foreground text-sm">{t('imageDownloads.description')}</p>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void analyze()
        }}
      >
        <input
          aria-label="Image or webpage URL"
          className="beast-field min-w-0 flex-1"
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://website.com/image.jpg or a webpage URL"
          value={url}
        />
        <button
          className="rounded-lg bg-primary px-4 py-2 text-primary-foreground"
          disabled={busy || !url.trim()}
          type="submit"
        >
          {t('imageDownloads.find')}
        </button>
      </form>
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm">
          {t('imageDownloads.saveAs')}
          <select
            aria-label="Image output format"
            className="beast-field block"
            onChange={(event) => setOutput(event.target.value as ImageOutput)}
            value={output}
          >
            {(['original', 'png', 'jpeg', 'webp'] as const).map((format) => (
              <option key={format} value={format}>
                {format.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          {t('imageDownloads.minWidth')}
          <input
            aria-label="Minimum image width"
            className="beast-field block w-28"
            min={0}
            onChange={(event) => {
              setMinWidth(Math.max(0, Number(event.target.value)))
              setPage(0)
            }}
            type="number"
            value={minWidth}
          />
        </label>
        <button
          className="rounded-lg border px-3 py-2 text-sm"
          disabled={busy}
          onClick={async () => {
            const chosen = await ipcServices.fs.selectDirectory()
            if (chosen) {
              setFolder(chosen)
            }
          }}
          type="button"
        >
          {t('imageDownloads.chooseFolder')}
        </button>
        <span className="max-w-sm truncate text-muted-foreground text-xs" title={folder}>
          {folder || t('imageDownloads.defaultFolder')}
        </span>
      </div>
      <p className="text-muted-foreground text-xs">{t('imageDownloads.conversion')}</p>
      <div className="flex flex-wrap gap-2">
        <button
          className="rounded-lg border px-3 py-2 text-sm"
          disabled={busy || !filtered.length}
          onClick={() => setSelected(filtered.slice(0, 100).map((image) => image.url))}
          type="button"
        >
          {t('imageDownloads.selectAll')}
        </button>
        <button
          className="rounded-lg border px-3 py-2 text-sm"
          disabled={busy}
          onClick={() => setSelected([])}
          type="button"
        >
          {t('imageDownloads.clear')}
        </button>
        <button
          className="rounded-lg bg-primary px-3 py-2 text-primary-foreground text-sm"
          disabled={busy || !selected.length}
          onClick={() => void save()}
          type="button"
        >
          {t('imageDownloads.saveSelected')} ({selected.length})
        </button>
        {!!failed.length && (
          <button
            className="rounded-lg border px-3 py-2 text-sm"
            disabled={busy}
            onClick={() => void save(true)}
            type="button"
          >
            {t('imageDownloads.retryFailed')} ({failed.length})
          </button>
        )}
      </div>
      <p className="break-words text-sm" role="status">
        {message}
      </p>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
        {shown.map((image) => (
          <ImageCard
            checked={selected.includes(image.url)}
            chosen={choices[image.url] || image.url}
            image={image}
            key={image.url}
            onChoose={(value) => setChoices((current) => ({ ...current, [image.url]: value }))}
            onSelect={() =>
              setSelected((current) =>
                current.includes(image.url)
                  ? current.filter((value) => value !== image.url)
                  : current.length < 100
                    ? [...current, image.url]
                    : current
              )
            }
          />
        ))}
      </div>
      {!!filtered.length && (
        <div className="flex items-center gap-3">
          <button disabled={page === 0} onClick={() => setPage(page - 1)} type="button">
            {t('imageDownloads.previous')}
          </button>
          <span className="text-sm">
            Page {page + 1} / {Math.ceil(filtered.length / 12)}
          </span>
          <button
            disabled={(page + 1) * 12 >= filtered.length}
            onClick={() => setPage(page + 1)}
            type="button"
          >
            {t('imageDownloads.next')}
          </button>
        </div>
      )}
    </section>
  )
}
