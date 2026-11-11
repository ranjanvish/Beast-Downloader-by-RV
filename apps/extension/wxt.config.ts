import { defineConfig } from 'wxt'
import identity from './beast-identity.json'
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    default_locale: 'en',
    name: 'Beast Browser Companion',
    description: 'Choose videos, audio languages and images for Beast Downloader.',
    action: { default_title: 'Beast Browser Companion' },
    version: '1.3.3',
    key: identity.key,
    incognito: 'not_allowed',
    host_permissions: ['http://127.0.0.1/*'],
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    permissions: ['activeTab', 'storage', 'scripting', 'contextMenus', 'downloads', 'webRequest', 'alarms'],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none'"
    },
    commands: {
      'open-beast': {
        suggested_key: { default: 'Alt+Shift+B' },
        description: 'Open Beast media and images'
      }
    }
  }
})
