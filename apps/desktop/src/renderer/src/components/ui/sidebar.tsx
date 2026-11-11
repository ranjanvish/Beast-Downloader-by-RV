import { AppSidebar, type AppSidebarItem } from '@vidbee/ui/components/ui/app-sidebar'
import { appSidebarIcons } from '@vidbee/ui/components/ui/app-sidebar-icons'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import '../../assets/title-bar.css'
import { updateAvailableAtom } from '@renderer/store/update'

type Page = 'extensions' | 'about' | 'home' | 'settings' | 'subscriptions'

interface SidebarProps {
  currentPage: Page
  onPageChange: (page: Page) => void
  onOpenTools: () => void
  transcriptsActive?: boolean
}

/**
 * Render the desktop navigation sidebar.
 */
export function Sidebar({
  currentPage,
  onPageChange,
  onOpenTools: _onOpenTools,
  transcriptsActive = false
}: SidebarProps) {
  const { t } = useTranslation()
  const updateAvailable = useAtomValue(updateAvailableAtom)

  const items: AppSidebarItem[] = [
    {
      id: 'extensions',
      active: currentPage === 'extensions',
      icon: appSidebarIcons.tools,
      label: 'Extensions',
      onClick: () => onPageChange('extensions')
    },
    {
      id: 'home',
      active: currentPage === 'home',
      icon: appSidebarIcons.home,
      indicator: transcriptsActive,
      label: t('menu.home'),
      onClick: () => onPageChange('home')
    },
    {
      id: 'subscriptions',
      active: currentPage === 'subscriptions',
      icon: appSidebarIcons.subscriptions,
      label: t('menu.rss'),
      onClick: () => onPageChange('subscriptions')
    }
  ]

  const bottomItems: AppSidebarItem[] = [
    {
      id: 'settings',
      active: currentPage === 'settings',
      icon: appSidebarIcons.settings,
      label: t('menu.preferences'),
      onClick: () => onPageChange('settings'),
      showLabel: false,
      showTooltip: true
    },
    {
      id: 'about',
      active: currentPage === 'about',
      icon: appSidebarIcons.about,
      indicator: updateAvailable.available,
      label: t('menu.about'),
      onClick: () => onPageChange('about'),
      showLabel: false,
      showTooltip: true
    }
  ]

  return (
    <AppSidebar
      appName="Beast"
      bottomItems={bottomItems}
      items={items}
      logoAlt="Beast Downloader by RV"
    />
  )
}
