import { DownloadEngineRow } from '@renderer/components/kernel/DownloadEngineRow'
import { ipcServices } from '@renderer/lib/ipc'
import { ytdlpKernelStatusAtom } from '@renderer/store/ytdlp-kernel'
import { useAtomValue } from 'jotai'
import { useEffect, useState } from 'react'

export function About() {
  const status = useAtomValue(ytdlpKernelStatusAtom)
  const [version, setVersion] = useState('1.0.0')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void ipcServices.app
      .getVersion()
      .then(setVersion)
      .catch(() => {})
  }, [])
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <section className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-center gap-5">
          <img alt="Beast Downloader logo" className="h-20 w-20 rounded-2xl" src="./app-icon.png" />
          <div>
            <h1 className="font-bold text-2xl">Beast Downloader by RV</h1>
            <p className="mt-2 text-muted-foreground">Version {version} · Windows</p>
          </div>
        </div>
        <p className="mt-5 text-sm leading-6">
          Free video and audio downloads, available language tracks, playlists and precise clips.
          Your download library stays on your computer.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            className="rounded-lg bg-primary px-4 py-2 text-primary-foreground text-sm disabled:opacity-50"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                const result = await ipcServices.update.checkForUpdates()
                setMessage(
                  result.error
                    ? 'No published Beast update could be reached. Please try again later.'
                    : result.available
                      ? `Version ${result.version} is available. It will download automatically.`
                      : 'You have the latest available version.'
                )
              } catch {
                setMessage('Could not check for updates. Please try again later.')
              } finally {
                setBusy(false)
              }
            }}
            type="button"
          >
            {busy ? 'Checking…' : 'Check for updates'}
          </button>
          <a
            className="rounded-lg border border-border px-4 py-2 text-sm"
            href="https://github.com/ranjanvish/VidBee"
            rel="noopener noreferrer"
            target="_blank"
          >
            Project & source code
          </a>
        </div>
        <p className="mt-3 text-muted-foreground text-sm" role="status">
          {message}
        </p>
      </section>
      <section className="rounded-2xl border border-border">
        <DownloadEngineRow status={status} />
      </section>
      <section className="space-y-3 rounded-2xl border border-border p-6 text-sm leading-6">
        <h2 className="font-semibold">Open-source credits</h2>
        <p>
          Built from{' '}
          <a
            className="text-primary"
            href="https://github.com/nexmoe/VidBee"
            rel="noopener noreferrer"
            target="_blank"
          >
            VidBee by nexmoe
          </a>
          , under the MIT license. Downloads are powered by yt-dlp, with audio/video processing by
          FFmpeg.
        </p>
        <p className="text-muted-foreground">
          The installer includes third-party license notices. Source languages and quality depend on
          the video and the site's downloadable formats.
        </p>
      </section>
    </div>
  )
}
