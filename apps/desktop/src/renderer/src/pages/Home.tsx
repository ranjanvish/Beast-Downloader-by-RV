import { UnifiedDownloadHistory } from '../components/download/UnifiedDownloadHistory'
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
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="beast-hero">
        <h1>
          Beast Downloader <span className="text-primary">by RV</span>
        </h1>
        <p>Your videos. Your language. Your perfect cut.</p>
      </header>
      <div className="min-h-0 flex-1">
        <UnifiedDownloadHistory
          onOpenCookiesSettings={onOpenCookiesSettings}
          onOpenSettings={onOpenSettings}
          onOpenSupportedSites={onOpenSupportedSites}
          topContent={
            <UpdateOutdatedNotice currentVersion={appVersion} onOpenAbout={onOpenAbout} />
          }
        />
      </div>
      <UpdateRestartNotice />
    </div>
  )
}
