import { appHealth, publicUrl, type Media } from '../lib/media'
import { resolveMediaTarget } from '../lib/clicked-media'
const captures = new Map<number, Media[]>()
const contextMedia = new Map<string, { target: unknown; page: unknown; time: number }>()
const lastOpen = new Map<number, number>()
export default defineBackground(() => {
  const checkUpdate = async () => {
    try {
      const status = await appHealth()
      await browser.action.setBadgeText({ text: '' })
      if (!status.companionReady || !status.companionVersion || status.companionVersion === browser.runtime.getManifest().version) return
      const { busyUntil, reloadTarget } = await browser.storage.local.get(['busyUntil','reloadTarget'])
      if (typeof busyUntil === 'number' && busyUntil > Date.now()) return
      if (reloadTarget === status.companionVersion) { await browser.action.setBadgeText({text:'UP'}); return }
      await browser.storage.local.set({ reloadTarget: status.companionVersion })
      browser.runtime.reload()
    } catch {
      await browser.action.setBadgeText({ text: '!' })
      await browser.action.setBadgeBackgroundColor({ color: '#b33b20' })
    }
  }
  browser.alarms.create('beast-sync', { periodInMinutes: 1 })
  browser.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'beast-sync') void checkUpdate() })
  let syncing = Promise.resolve()
  const syncOverlay = () => {
    syncing = syncing.catch(() => {}).then(async () => {
      const { floatingButtons } = await browser.storage.local.get('floatingButtons')
      const granted = await browser.permissions.getAll()
      const matches = (granted.origins || []).filter((origin) =>
        origin !== 'http://127.0.0.1/*' && /^https?:\/\//.test(origin))
      await browser.scripting.unregisterContentScripts({ ids: ['beast-overlay'] }).catch(() => {})
      if (floatingButtons && matches.length) {
        await browser.scripting.registerContentScripts([{
          id: 'beast-overlay', js: ['media-overlay.js'], matches,
          allFrames: true, runAt: 'document_idle', persistAcrossSessions: true
        }])
      }
      const tabs = await browser.tabs.query({})
      for (const tab of tabs) {
        if (tab.id === undefined || !publicUrl(tab.url)) continue
        // Remove old overlays first, including after permission revocation.
        await browser.tabs.sendMessage(tab.id, { type: 'remove-overlay' }).catch(() => {})
        if (floatingButtons && matches.length) {
          await browser.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['media-overlay.js'] }).catch(() => {})
        }
      }
    })
    return syncing
  }
  browser.permissions.onAdded.addListener(() => { void syncOverlay() })
  browser.permissions.onRemoved.addListener(() => { void syncOverlay() })
  browser.runtime.onStartup.addListener(() => { void syncOverlay() })
  browser.runtime.onInstalled.addListener(() => {
    void browser.contextMenus
      .removeAll()
      .then(() => {
        for (const kind of ['video', 'audio', 'image'] as const) {
          browser.contextMenus.create({ id: `beast-${kind}`, title: `Download ${kind} with Beast…`, contexts: [kind] })
        }
        browser.contextMenus.create({ id: 'beast', title: 'Find downloads with Beast…', contexts: ['page', 'link'] })
      })
    void syncOverlay()
  })
  const open = async (tabId?: number, target?: string, kind?: string, variants?: unknown) => {
    if (tabId === undefined) return
    await browser.tabs.create({
      url:
        browser.runtime.getURL('/popup.html') +
        `?tab=${tabId}&kind=${encodeURIComponent(kind || '')}&auto=1${target && publicUrl(target) ? '&target=' + encodeURIComponent(target) : kind ? '&unresolved=1' : ''}${Array.isArray(variants) ? '&variants=' + encodeURIComponent(JSON.stringify(variants.slice(0,20))) : ''}`
    })
  }
  browser.contextMenus.onClicked.addListener((info, tab) => {
    const page = info.frameUrl || info.pageUrl || tab?.url
    const saved = contextMedia.get(`${tab?.id}:${info.frameId || 0}`)
    const source = saved && Date.now() - saved.time < 5000 ? saved.target : info.srcUrl || info.linkUrl
    void open(tab?.id, resolveMediaTarget(source, page, info.mediaType || '') || (!info.mediaType && publicUrl(page) ? page : undefined), info.mediaType)
  })
  browser.commands.onCommand.addListener(async () => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
    await open(tab?.id)
  })
  browser.tabs.onRemoved.addListener((id) => { captures.delete(id); lastOpen.delete(id) })
  browser.tabs.onUpdated.addListener((id, change) => {
    if (change.status === 'loading' && captures.has(id)) captures.set(id, [])
  })
  browser.runtime.onMessage.addListener((message, sender) => {
    if (!message || typeof message !== 'object') return
    if (message.type === 'context-media') {
      if (sender.id !== browser.runtime.id || sender.tab?.id === undefined || !publicUrl(sender.url)) return
      if (contextMedia.size > 100) contextMedia.clear()
      contextMedia.set(`${sender.tab.id}:${sender.frameId || 0}`, { target: message.target, page: message.page, time: Date.now() })
      return
    }
    if (message.type === 'open-media') {
      // Content scripts can only open a chooser, never authorize a download.
      if (sender.id !== browser.runtime.id || sender.tab?.id === undefined || !publicUrl(sender.url) || !['video', 'audio', 'image'].includes(message.kind)) return
      const id = sender.tab.id
      if (Date.now() - (lastOpen.get(id) || 0) < 1000) return
      lastOpen.set(id, Date.now())
      const page = publicUrl(message.page) && new URL(message.page).origin === new URL(sender.url).origin ? message.page : sender.url
      return open(id, resolveMediaTarget(message.target, page, message.kind), message.kind, message.variants).then(() => ({ ok: true }))
    }
    // Only our extension UI can arm capture. Web pages/content scripts cannot.
    if (
      sender.id !== browser.runtime.id ||
      !sender.url?.startsWith(browser.runtime.getURL('/')) ||
      sender.tab?.url?.startsWith('http')
    )
      return
    if (message.type === 'overlay') {
      return browser.storage.local.set({ floatingButtons: message.enabled === true }).then(syncOverlay).then(() => ({ ok: true }))
    }
    if (message.type === 'check-update') return checkUpdate().then(()=>({ok:true}))
    if (message.type === 'capture' && Number.isInteger(message.tabId)) {
      if (captures.size >= 12) captures.delete(captures.keys().next().value!)
      captures.set(message.tabId, [])
      return Promise.resolve({ ok: true })
    }
    if (message.type === 'captured') return Promise.resolve(captures.get(message.tabId) || [])
    if (message.type === 'clear') {
      captures.delete(message.tabId)
      return Promise.resolve({ ok: true })
    }
  })
  browser.webRequest.onHeadersReceived.addListener(
    (details) => {
      const list = captures.get(details.tabId)
      if (
        !list ||
        list.length >= 200 ||
        !publicUrl(details.url) ||
        /\.(?:ts|m4s)(?:\?|$)/i.test(details.url)
      )
        return
      const type =
        details.responseHeaders?.find((h) => h.name.toLowerCase() === 'content-type')?.value || ''
      const kind = type.startsWith('audio/')
        ? 'audio'
        : /video\/|mpegurl|dash\+xml/i.test(type)
          ? 'video'
          : null
      if (kind && !list.some((m) => m.url === details.url)) list.push({ url: details.url, kind })
    },
    { urls: ['http://*/*', 'https://*/*'] },
    ['responseHeaders']
  )
})
