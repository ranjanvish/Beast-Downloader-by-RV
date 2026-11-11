import type { VideoInfo } from '@shared/types'
import { useRef, useState } from 'react'

export const clipSeconds = (value: string): number => {
  if (!value.trim()) {
    return 0
  }
  if (!/^\d+(?::[0-5]?\d){0,2}(?:\.\d+)?$/.test(value.trim())) {
    return Number.NaN
  }
  return value.split(':').reduce((total, part) => total * 60 + Number(part), 0)
}

const timestamp = (seconds: number) => {
  const rounded = Math.floor(seconds)
  return [Math.floor(rounded / 3600), Math.floor((rounded % 3600) / 60), rounded % 60]
    .map((part) => String(part).padStart(2, '0'))
    .join(':')
}

export function BeastClip({
  info,
  startTime,
  endTime,
  onChange
}: {
  info: VideoInfo
  startTime: string
  endTime: string
  onChange: (value: { startTime?: string; endTime?: string }) => void
}) {
  const [enabled, setEnabled] = useState(Boolean(startTime || endTime))
  const [preview, setPreview] = useState(false)
  const [failed, setFailed] = useState(false)
  const player = useRef<HTMLVideoElement>(null)
  const duration = info.duration ?? 0
  const start = clipSeconds(startTime)
  const end = endTime ? clipSeconds(endTime) : duration
  const valid =
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    start >= 0 &&
    end > start &&
    (!duration || end <= duration)
  const previewFormat = [...info.formats]
    .filter(
      (f) => f.url?.startsWith('https://') && f.ext === 'mp4' && f.vcodec !== 'none' && f.height
    )
    .sort((a, b) => (a.height ?? 0) - (b.height ?? 0))[0]
  return (
    <section className="space-y-3 rounded-xl border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-sm">Download range</span>
        <select
          aria-label="Download range"
          className="beast-field max-w-48"
          onChange={(event) => {
            const clip = event.target.value === 'clip'
            setEnabled(clip)
            onChange(
              clip
                ? { startTime: '00:00:00', endTime: duration ? timestamp(duration) : '' }
                : { startTime: '', endTime: '' }
            )
          }}
          value={enabled ? 'clip' : 'full'}
        >
          <option value="full">Full video / audio</option>
          <option value="clip">Selected part only</option>
        </select>
      </div>
      {enabled && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-xs">
              Start · HH:MM:SS
              <input
                aria-label="Clip start time"
                className="beast-field"
                onChange={(e) => onChange({ startTime: e.target.value })}
                value={startTime}
              />
            </label>
            <label className="space-y-1 text-xs">
              End · HH:MM:SS
              <input
                aria-label="Clip end time"
                className="beast-field"
                onChange={(e) => onChange({ endTime: e.target.value })}
                placeholder="End of video"
                value={endTime}
              />
            </label>
          </div>
          {duration > 0 && (
            <div className="space-y-2">
              <label className="block text-muted-foreground text-xs">
                Drag start
                <input
                  aria-label="Clip start slider"
                  className="beast-range"
                  max={Math.max(0, duration - 1)}
                  min="0"
                  onChange={(e) => {
                    const next = Math.min(
                      Number(e.target.value),
                      (Number.isFinite(end) ? end : duration) - 1
                    )
                    onChange({ startTime: timestamp(Math.max(0, next)) })
                    if (player.current) {
                      player.current.currentTime = Math.max(0, next)
                    }
                  }}
                  step="1"
                  type="range"
                  value={Number.isFinite(start) ? start : 0}
                />
              </label>
              <label className="block text-muted-foreground text-xs">
                Drag end
                <input
                  aria-label="Clip end slider"
                  className="beast-range"
                  max={duration}
                  min="1"
                  onChange={(e) =>
                    onChange({
                      endTime: timestamp(
                        Math.max(Number(e.target.value), (Number.isFinite(start) ? start : 0) + 1)
                      )
                    })
                  }
                  step="1"
                  type="range"
                  value={Number.isFinite(end) ? end : duration}
                />
              </label>
            </div>
          )}
          {!valid && (
            <p className="text-red-500 text-xs" role="alert">
              Enter valid times. End must be after start and within the video duration.
            </p>
          )}
          {valid && (
            <p className="text-muted-foreground text-xs">
              Selected duration: {timestamp(end - start)}. Precise cuts may take extra processing.
            </p>
          )}
          {previewFormat && !preview && (
            <button className="text-primary text-sm" onClick={() => setPreview(true)} type="button">
              Open video preview
            </button>
          )}
          {preview && !failed && (
            <video
              className="max-h-48 w-full rounded-lg bg-black"
              controls
              muted
              onError={() => setFailed(true)}
              onLoadedMetadata={() => {
                if (player.current && valid) {
                  player.current.currentTime = start
                }
              }}
              onTimeUpdate={() => {
                if (player.current && valid && player.current.currentTime >= end) {
                  player.current.pause()
                }
              }}
              preload="metadata"
              ref={player}
              src={previewFormat?.url}
            >
              <track kind="captions" label="Preview" />
            </video>
          )}
          {(failed || !previewFormat) && (
            <p className="text-muted-foreground text-xs">
              This source does not allow an in-app preview. You can still set the clip times above.
            </p>
          )}
        </>
      )}
    </section>
  )
}
