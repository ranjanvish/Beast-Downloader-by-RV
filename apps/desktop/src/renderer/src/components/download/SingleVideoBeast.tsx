import { RemoteImage } from '@renderer/components/ui/remote-image'
import type { VideoFormat, VideoInfo } from '@shared/types'
import { useEffect, useMemo } from 'react'
import { BeastClip } from './BeastClip'
import { DownloadParseErrorBanner } from './DownloadParseErrorBanner'

export interface SingleVideoState {
  title: string
  activeTab: 'video' | 'audio'
  selectedVideoFormat: string
  selectedAudioFormat: string
  customDownloadPath: string
  startTime: string
  endTime: string
  selectedContainer?: string
  selectedCodec?: string
  selectedFps?: string
  audioBitrate?: number
  embedAudioCover?: boolean
}

interface Props {
  loading: boolean
  error: string | null
  videoInfo: VideoInfo | null
  state: SingleVideoState
  feedbackSourceUrl?: string | null
  ytDlpCommand?: string
  onStateChange: (state: Partial<SingleVideoState>) => void
}

function languageName(format: VideoFormat) {
  let name = format.language || 'Source audio'
  if (format.language) {
    try {
      name = new Intl.DisplayNames(['en'], { type: 'language' }).of(format.language) || name
    } catch {
      /* Preserve extractor language labels. */
    }
  }
  const original = /original/i.test(format.format_note || '') ? ' · Original' : ''
  return `${name}${original} · ${Math.round(format.tbr || 0) || 'Auto'} kbps · ${format.ext.toUpperCase()}`
}

export function SingleVideoDownload({
  loading,
  error,
  videoInfo,
  state,
  feedbackSourceUrl,
  ytDlpCommand,
  onStateChange
}: Props) {
  const videos = useMemo(() => {
    const candidates = (videoInfo?.formats || []).filter(
      (f) =>
        f.vcodec &&
        f.vcodec !== 'none' &&
        (!f.height || f.height <= 2160) &&
        !f.format_note?.includes('storyboard')
    )
    return candidates.sort(
      (a, b) =>
        (b.height || 0) - (a.height || 0) ||
        (b.fps || 0) - (a.fps || 0) ||
        Number(b.protocol === 'https') - Number(a.protocol === 'https')
    )
  }, [videoInfo])
  const audios = useMemo(() => {
    const all = (videoInfo?.formats || []).filter((f) => f.acodec && f.acodec !== 'none')
    const separate = all.filter((f) => !f.vcodec || f.vcodec === 'none')
    return (separate.length ? separate : all).sort(
      (a, b) => (a.language || '').localeCompare(b.language || '') || (b.tbr || 0) - (a.tbr || 0)
    )
  }, [videoInfo])
  useEffect(() => {
    const update: Partial<SingleVideoState> = {}
    if (videos.length && !videos.some((f) => f.format_id === state.selectedVideoFormat)) {
      update.selectedVideoFormat =
        (videos.find((f) => f.height === 1080) || videos[0])?.format_id || ''
    }
    if (audios.length && !audios.some((f) => f.format_id === state.selectedAudioFormat)) {
      update.selectedAudioFormat =
        (audios.find((f) => /original/i.test(f.format_note || '')) || audios[0])?.format_id || ''
    }
    if (Object.keys(update).length) {
      onStateChange(update)
    }
  }, [videos, audios, state.selectedVideoFormat, state.selectedAudioFormat, onStateChange])

  if (loading) {
    return (
      <div className="py-14 text-center text-muted-foreground">
        Finding available qualities and audio languages…
      </div>
    )
  }
  if (error) {
    return (
      <DownloadParseErrorBanner
        error={error}
        sourceUrl={feedbackSourceUrl}
        title="Could not read this link"
        ytDlpCommand={ytDlpCommand}
      />
    )
  }
  if (!videoInfo) {
    return (
      <div className="py-14 text-center text-muted-foreground">
        Paste a video link to choose quality, language and download range.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/20 p-3">
        <RemoteImage
          alt={videoInfo.title}
          className="h-16 w-28 shrink-0 rounded-lg object-cover"
          src={videoInfo.thumbnail}
        />
        <div className="min-w-0">
          <h2 className="line-clamp-2 font-semibold text-sm">{videoInfo.title}</h2>
          <p className="mt-1 text-muted-foreground text-xs">
            {videoInfo.uploader} ·{' '}
            {videoInfo.duration
              ? `${Math.floor(videoInfo.duration / 60)}m ${Math.floor(videoInfo.duration % 60)}s`
              : 'Duration unavailable'}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {(['video', 'audio'] as const).map((type) => (
          <button
            aria-pressed={state.activeTab === type}
            className={`rounded-lg border px-4 py-2 font-medium text-sm ${state.activeTab === type ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`}
            key={type}
            onClick={() => onStateChange({ activeTab: type })}
            type="button"
          >
            {type === 'video' ? 'Video + Audio' : 'Audio only'}
          </button>
        ))}
      </div>
      {state.activeTab === 'video' && (
        <label className="block space-y-1 text-xs">
          Video quality · available from this source
          <select
            aria-label="Video quality"
            className="beast-field"
            onChange={(e) => onStateChange({ selectedVideoFormat: e.target.value })}
            value={state.selectedVideoFormat}
          >
            {videos.map((f) => (
              <option key={f.format_id} value={f.format_id}>
                {f.height ? `${f.height}p` : 'Source'} · {f.ext.toUpperCase()} · {f.fps || 'Auto'}{' '}
                fps · {f.vcodec?.split('.')[0]}
                {f.filesize ? ` · ${Math.round(f.filesize / 1e6)} MB` : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block space-y-1 text-xs">
        Audio language / dubbing · source track
        <select
          aria-label="Audio language and track"
          className="beast-field"
          disabled={!audios.length}
          onChange={(e) => onStateChange({ selectedAudioFormat: e.target.value })}
          value={state.selectedAudioFormat}
        >
          {!audios.length && <option value="">No separate audio track available</option>}
          {audios.map((f) => (
            <option key={f.format_id} value={f.format_id}>
              {languageName(f)}
            </option>
          ))}
        </select>
      </label>
      <p className="text-muted-foreground text-xs">
        Only languages exposed by this video are listed. Your selected track is preserved; another
        language is never substituted silently.
      </p>
      {state.activeTab === 'audio' && (
        <label className="block space-y-1 text-xs">
          Audio output quality
          <select
            aria-label="Audio output bitrate"
            className="beast-field"
            onChange={(e) => onStateChange({ audioBitrate: Number(e.target.value) })}
            value={state.audioBitrate ?? 192}
          >
            <option value="0">Original audio · no conversion</option>
            {[64, 96, 128, 160, 192, 256, 320].map((rate) => (
              <option key={rate} value={rate}>
                MP3 · {rate} kbps
              </option>
            ))}
          </select>
          <span className="block text-muted-foreground">
            Higher output bitrate cannot restore quality missing from the source.
          </span>
        </label>
      )}
      {state.activeTab === 'audio' && (
        <label className="flex items-center gap-2 text-xs">
          <input
            checked={state.embedAudioCover ?? true}
            onChange={(event) => onStateChange({ embedAudioCover: event.target.checked })}
            type="checkbox"
          />
          Use video thumbnail as audio cover
        </label>
      )}
      <BeastClip
        endTime={state.endTime}
        info={videoInfo}
        key={videoInfo.id}
        onChange={onStateChange}
        startTime={state.startTime}
      />
    </div>
  )
}
