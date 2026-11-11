import { ipcServices } from '@renderer/lib/ipc'
import { useState } from 'react'
export function BeastExtensions() {
  const [browser, setBrowser] = useState('Chrome'),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false)
  const address =
    browser === 'Edge'
      ? 'edge://extensions'
      : browser === 'Brave'
        ? 'brave://extensions'
        : browser === 'Opera'
          ? 'opera://extensions'
          : 'chrome://extensions'
  const install = async () => {
    setBusy(true)
    try {
      const path = await ipcServices.app.installBeastExtension()
      setMessage(
        `Setup path copied. In ${browser}, choose Load unpacked and paste this path: ${path}. Browser confirmation is still required; the extension is not installed yet.`
      )
    } catch {
      setMessage(
        'Could not prepare the extension. Reinstall the current Beast application and try again.'
      )
    } finally {
      setBusy(false)
    }
  }
  const test = async () => {
    try {
      const status = await ipcServices.app.getBeastExtensionStatus()
      setMessage(
        status.connected
          ? 'A Beast extension contacted this app recently. Run Analyze in the extension for an end-to-end connection test.'
          : 'No recent extension request. Open your browser, click Beast and choose Analyze / Test connection. This does not mean the extension was deleted.'
      )
    } catch {
      setMessage('Connection status unavailable. Restart Beast and try again.')
    }
  }
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <h1 className="font-bold text-2xl">Extensions & Browser Integration</h1>
      <p>
        Download videos, choose dubbing tracks and collect images from your browser. This page
        always stays available if you remove the extension.
      </p>
      <section className="space-y-4 rounded-xl border border-border bg-card p-6">
        <h2 className="font-semibold text-lg">Install or reinstall Beast Browser Companion</h2>
        <label className="block">
          Your browser
          <select
            className="beast-field mt-2"
            onChange={(e) => setBrowser(e.target.value)}
            value={browser}
          >
            {['Chrome', 'Edge', 'Brave', 'Opera'].map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </label>
        <p>
          Private local extension. No browser-store upload has been made. Chrome-based browsers
          require a one-time manual setup for this build; this button cannot trigger an automatic
          Enable prompt. It prepares the files and copies their location without opening a folder.
        </p>
        <ol className="list-decimal space-y-2 pl-5">
          <li>Click Copy extension setup path below.</li>
          <li>
            Open <strong>{address}</strong> in {browser}.
          </li>
          <li>Turn on Developer mode, choose Load unpacked, paste the copied path and confirm.</li>
          <li>
            Pin Beast Browser Companion. Click its icon and choose Enable floating download buttons.
            Allow website access to show video/audio buttons and image buttons on hover.
          </li>
          <li>
            If already installed, use the browser extension’s Reload button after preparing an
            update.
          </li>
        </ol>
        <div className="flex flex-wrap gap-3">
          <button
            className="rounded-lg bg-primary px-4 py-2 text-primary-foreground"
            disabled={busy}
            onClick={() => void install()}
            type="button"
          >
            Copy extension setup path
          </button>
          <button
            className="rounded-lg border border-border px-4 py-2"
            onClick={() => void test()}
            type="button"
          >
            Check connection
          </button>
        </div>
        <p className="text-muted-foreground text-sm">
          Deleting the extension will not trigger a silent reinstall. Come back here whenever you
          want it again.
        </p>
      </section>
      {message && (
        <p className="rounded-lg border border-border p-4 text-sm" role="status">
          {message}
        </p>
      )}
      <section className="space-y-3 rounded-xl border border-border p-6">
        <h2 className="font-semibold text-lg">Permissions & security</h2>
        <p>
          Scanning runs when you click. Network detection asks for optional website access and
          watches only tabs you arm. You can revoke access from the extension’s privacy panel.
        </p>
        <p>
          The app accepts requests from the bundled Beast extension using short-lived, one-use
          tokens. No password or cookie collection is added to this extension. Use desktop cookie
          settings only when a website requires account access.
        </p>
        <p>
          Video and audio use the desktop queue. Images save through browser Downloads. Use the
          extension’s full view for image batches.
        </p>
        <p className="text-muted-foreground text-sm">
          Available source languages only. Some sites expose only the current player language. DRM
          and site access restrictions still apply. Security updates remain necessary.
        </p>
      </section>
    </main>
  )
}
