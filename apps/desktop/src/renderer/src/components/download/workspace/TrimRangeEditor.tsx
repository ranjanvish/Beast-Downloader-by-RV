import {
  formatClipTime,
  type MixedEntry,
  type MixedOptions,
  parseClipTime
} from '@shared/mixed-download'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** Both editing methods submit the same atomic range to the existing queue validator. */
export function TrimRangeEditor({
  entry,
  commit
}: {
  entry: MixedEntry
  commit: (patch: Partial<MixedOptions>) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const duration = entry.info?.duration || 0
  const [start, setStart] = useState(entry.options.start)
  const [end, setEnd] = useState(entry.options.end)
  const [error, setError] = useState(false)
  useEffect(() => {
    setStart(entry.options.start)
    setEnd(entry.options.end)
  }, [entry.options.start, entry.options.end])
  const from = start ? parseClipTime(start) : 0
  const to = end ? parseClipTime(end) : duration
  const valid =
    Number.isFinite(from) &&
    from >= 0 &&
    (!end || (Number.isFinite(to) && to > from)) &&
    (!duration || (from < duration && to <= duration))
  const save = async () => {
    if (!valid) {
      setStart(entry.options.start)
      setEnd(entry.options.end)
      setError(true)
      return
    }
    const saved = await commit({ start, end })
    if (!saved) {
      setStart(entry.options.start)
      setEnd(entry.options.end)
    }
    setError(!saved)
  }
  return (
    <div className="beast-trim sm:col-span-2 lg:col-span-3" data-ui="trim-editor">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold text-sm">{t('workspace.trim')}</h4>
        <span className="text-muted-foreground text-xs">
          {valid && to > from
            ? `${formatClipTime(to - from)} ${t('workspace.selected')}`
            : t('workspace.fullLength')}
        </span>
      </div>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <label className="space-y-2 text-xs">
          {t('workspace.start')}
          <input
            aria-label="Start time"
            className="beast-field font-mono"
            onBlur={() => void save()}
            onChange={(e) => {
              setStart(e.target.value)
              setError(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void save()
              }
            }}
            placeholder="00:00:00.000"
            value={start}
          />
          {duration > 0 && (
            <input
              aria-label="Trim start slider"
              className="beast-range"
              max={duration}
              min={0}
              onChange={(e) => {
                const value = Math.min(Number(e.target.value), Math.max(0, to - 0.01))
                setStart(formatClipTime(value))
                setError(false)
              }}
              onKeyUp={() => void save()}
              onPointerUp={() => void save()}
              step={0.01}
              type="range"
              value={Number.isFinite(from) ? from : 0}
            />
          )}
        </label>
        <label className="space-y-2 text-xs">
          {t('workspace.end')}
          <input
            aria-label="End time"
            className="beast-field font-mono"
            onBlur={() => void save()}
            onChange={(e) => {
              setEnd(e.target.value)
              setError(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void save()
              }
            }}
            placeholder={t('workspace.fullLength')}
            value={end}
          />
          {duration > 0 && (
            <input
              aria-label="Trim end slider"
              className="beast-range"
              max={duration}
              min={0}
              onChange={(e) => {
                const value = Math.max(Number(e.target.value), Math.min(duration, from + 0.01))
                setEnd(formatClipTime(value))
                setError(false)
              }}
              onKeyUp={() => void save()}
              onPointerUp={() => void save()}
              step={0.01}
              type="range"
              value={Number.isFinite(to) ? to : duration}
            />
          )}
        </label>
      </div>
      {duration > 0 && valid && (
        <div aria-hidden="true" className="beast-trim-track">
          <span
            style={{
              left: `${(from / duration) * 100}%`,
              width: `${((to - from) / duration) * 100}%`
            }}
          />
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span
          className={error || !valid ? 'text-destructive' : 'text-muted-foreground'}
          role={error || !valid ? 'alert' : undefined}
        >
          {error || !valid
            ? t('workspace.invalidRange')
            : duration > 0
              ? t('workspace.timeHint')
              : t('workspace.durationUnknown')}
        </span>
        <button
          className="rounded-lg border px-3 py-1"
          onClick={async () => {
            if (await commit({ start: '', end: '' })) {
              setStart('')
              setEnd('')
              setError(false)
            }
          }}
          type="button"
        >
          {t('workspace.reset')}
        </button>
      </div>
    </div>
  )
}
