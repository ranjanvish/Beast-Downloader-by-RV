import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AllInOneDownloads } from '../components/download/AllInOneDownloads'
import { UnifiedDownloadHistory } from '../components/download/UnifiedDownloadHistory'
import { DownloadFolderControl } from '../components/download/workspace/DownloadFolderControl'
import { UpdateOutdatedNotice } from '../components/update/UpdateOutdatedNotice'
import { UpdateRestartNotice } from '../components/update/UpdateRestartNotice'

interface HomeProps {
  appVersion: string
  onOpenAbout: () => void
  onOpenSupportedSites?: () => void
  onOpenSettings?: () => void
  onOpenCookiesSettings?: () => void
}

export function Home({
  appVersion,
  onOpenAbout,
  onOpenSupportedSites,
  onOpenSettings,
  onOpenCookiesSettings
}: HomeProps) {
  const { t } = useTranslation()
  const [libraryOpen, setLibraryOpen] = useState(false)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="beast-hero beast-header-row">
        <div>
          <h1>
            Beast Downloader <span className="text-primary">by RV</span>
          </h1>
          <p>
            {t('batch.tagline', {
              defaultValue: 'Images, audio and video. One queue. Your settings.'
            })}
          </p>
        </div>
        <DownloadFolderControl />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <UpdateOutdatedNotice currentVersion={appVersion} onOpenAbout={onOpenAbout} />
        <AllInOneDownloads />
        <details
          className="m-5 rounded-xl border border-border"
          onToggle={(event) => setLibraryOpen(event.currentTarget.open)}
        >
          <summary className="cursor-pointer p-4 font-semibold text-sm">
            {t('batch.library', { defaultValue: 'Previous video & audio library' })}
          </summary>
          <div className="h-[560px]">
            {libraryOpen && (
              <UnifiedDownloadHistory
                onOpenCookiesSettings={onOpenCookiesSettings}
                onOpenSettings={onOpenSettings}
                onOpenSupportedSites={onOpenSupportedSites}
                showAddAction={false}
              />
            )}
          </div>
        </details>
      </div>
      <UpdateRestartNotice />
    </div>
  )
}
