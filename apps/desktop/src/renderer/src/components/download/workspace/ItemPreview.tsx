import type { MixedEntry } from '@shared/mixed-download'
import { AudioLines, ImageIcon, Play, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ipcServices } from '../../../lib/ipc'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '../../ui/dialog'

const posters = new Map<string, Promise<string>>()
let posterQueue = Promise.resolve()
function loadPoster(url: string): Promise<string> {
  const cached = posters.get(url)
  if (cached) {
    return cached
  }
  const next = posterQueue
    .catch(() => {})
    .then(async () => {
      const value = await ipcServices.images.preview(url)
      if (!value) {
        throw new Error('No thumbnail available')
      }
      return value
    })
  posterQueue = next.then(
    () => {},
    () => {}
  )
  if (posters.size >= 100) {
    posters.delete(posters.keys().next().value || '')
  }
  posters.set(url, next)
  next.catch(() => posters.delete(url))
  return next
}

export function ItemPreview({ entry }: { entry: MixedEntry }) {
  const { t } = useTranslation()
  const [poster, setPoster] = useState<string>()
  const [failedLocalPoster, setFailedLocalPoster] = useState<string>()
  const localPoster =
    entry.kind === 'image' && entry.filePath ? `batch-media://${entry.id}/saved` : undefined
  const showLocalPoster = localPoster && failedLocalPoster !== localPoster
  const [open, setOpen] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [media, setMedia] = useState<{ src: string; kind: string; audioSrc?: string }>()
  const [error, setError] = useState('')
  const video = useRef<HTMLVideoElement>(null)
  const audio = useRef<HTMLAudioElement>(null)
  const imageUrl =
    entry.kind === 'image'
      ? entry.image?.previewUrl || entry.options.imageUrl || entry.image?.url
      : entry.info?.thumbnail
  useEffect(() => {
    let active = true
    setPoster(undefined)
    if (imageUrl && !showLocalPoster) {
      void loadPoster(imageUrl)
        .then((value) => {
          if (active) {
            setPoster(value)
          }
        })
        .catch(() => {})
    }
    return () => {
      active = false
    }
  }, [imageUrl, showLocalPoster])
  useEffect(() => {
    let active = true
    setMedia(undefined)
    setError('')
    if (open) {
      void ipcServices.batch
        .preview(entry.id, attempt > 0)
        .then((value) => {
          if (active) {
            setMedia(value)
          }
        })
        .catch((value) => {
          if (active) {
            setError(String(value))
          }
        })
    }
    return () => {
      active = false
      audio.current?.pause()
    }
  }, [open, entry.id, attempt])
  const syncAudio = () => {
    if (
      audio.current &&
      video.current &&
      Math.abs(audio.current.currentTime - video.current.currentTime) > 0.3
    ) {
      audio.current.currentTime = video.current.currentTime
    }
  }
  const failed = () => setError(t('workspace.playbackError'))
  const playAudio = () => {
    syncAudio()
    void audio.current?.play().catch((reason: unknown) => {
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
        failed()
      }
    })
  }
  return (
    <>
      <button
        aria-label={`${t('workspace.preview')}: ${entry.title}`}
        className="beast-preview-tile"
        data-ui="media-preview"
        onClick={() => setOpen(true)}
        type="button"
      >
        {showLocalPoster || poster ? (
          <img
            alt=""
            loading="lazy"
            onError={() => showLocalPoster && setFailedLocalPoster(localPoster)}
            src={showLocalPoster ? localPoster : poster}
          />
        ) : (
          <span className="beast-preview-placeholder">
            {entry.kind === 'audio' ? (
              <AudioLines size={30} />
            ) : entry.kind === 'image' ? (
              <ImageIcon size={30} />
            ) : (
              <Play size={30} />
            )}
            <small>{entry.kind}</small>
          </span>
        )}
        <span className="beast-preview-play">
          {entry.kind === 'image' ? <ImageIcon size={18} /> : <Play size={18} />}
        </span>
      </button>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent className="beast-preview-dialog sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="pr-8">{entry.title}</DialogTitle>
            <DialogDescription>{t('workspace.previewHint')}</DialogDescription>
          </DialogHeader>
          {error ? (
            <div className="space-y-3 rounded-xl bg-muted p-5" role="alert">
              <p>{error}</p>
              <button
                className="inline-flex items-center gap-2 rounded-lg border px-3 py-2"
                onClick={() => setAttempt((value) => value + 1)}
                type="button"
              >
                <RotateCcw size={16} />
                {t('workspace.retryPreview')}
              </button>
            </div>
          ) : media ? (
            media.kind === 'image' ? (
              <img
                alt={entry.title}
                className="beast-full-preview"
                onError={failed}
                src={media.src}
              />
            ) : media.kind === 'audio' ? (
              <div className="beast-audio-player">
                <AudioLines size={60} />
                <audio
                  aria-label={entry.title}
                  controls
                  onError={failed}
                  preload="metadata"
                  src={media.src}
                >
                  <track kind="captions" />
                </audio>
              </div>
            ) : (
              <div className="beast-video-player">
                <video
                  aria-label={entry.title}
                  controls
                  onEnded={() => audio.current?.pause()}
                  onError={failed}
                  onPause={() => audio.current?.pause()}
                  onPlay={playAudio}
                  onPlaying={playAudio}
                  onSeeking={syncAudio}
                  onTimeUpdate={syncAudio}
                  onVolumeChange={() => {
                    if (audio.current && video.current) {
                      audio.current.volume = video.current.volume
                      audio.current.muted = video.current.muted
                    }
                  }}
                  onWaiting={() => audio.current?.pause()}
                  playsInline
                  poster={poster}
                  preload="metadata"
                  ref={video}
                  src={media.src}
                >
                  <track kind="captions" />
                </video>
                {media.audioSrc && (
                  <audio onError={failed} preload="metadata" ref={audio} src={media.audioSrc}>
                    <track kind="captions" />
                  </audio>
                )}
              </div>
            )
          ) : (
            <div className="p-12 text-center" role="status">
              {t('workspace.loading')}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
