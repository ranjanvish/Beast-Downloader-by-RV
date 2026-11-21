import { useAtom } from 'jotai'
import { FolderOpen } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ipcServices } from '../../../lib/ipc'
import { settingsAtom } from '../../../store/settings'

export function DownloadFolderControl() {
  const { t } = useTranslation()
  const [settings, setSettings] = useAtom(settingsAtom)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const choose = async () => {
    setBusy(true)
    setError('')
    try {
      const folder = await ipcServices.fs.selectDirectory()
      if (folder) {
        await ipcServices.settings.set('downloadPath', folder)
        setSettings((previous) => ({ ...previous, downloadPath: folder }))
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="beast-default-folder" data-ui="default-download-folder">
      <button
        className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left"
        disabled={busy}
        onClick={() => void choose()}
        title={settings.downloadPath}
        type="button"
      >
        <FolderOpen className="h-5 w-5 shrink-0 text-primary" />
        <span className="min-w-0">
          <strong className="block text-sm">{t('library.folder')}</strong>
          <span className="block truncate text-muted-foreground text-xs">
            {settings.downloadPath || t('library.chooseFolder')}
          </span>
        </span>
      </button>
      {error && (
        <p className="mt-1 text-destructive text-xs" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
