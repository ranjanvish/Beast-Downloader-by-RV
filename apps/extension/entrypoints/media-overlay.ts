import { publicUrl } from '../lib/media'
import { clickedMedia } from '../lib/clicked-media'

export default defineUnlistedScript(() => {
  if (!publicUrl(location.href) || document.getElementById('beast-media-overlay')) return
  const host = document.createElement('div')
  host.id = 'beast-media-overlay'
  const root = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = `:host{all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important}button{position:fixed;pointer-events:auto;border:1px solid #ff647f;border-radius:7px;background:#17191f;color:white;padding:7px 11px;font:600 12px system-ui;box-shadow:0 2px 8px #0008;cursor:pointer}button:hover{background:#da244c}button:focus-visible{outline:3px solid #fff}`
  root.append(style)
  document.documentElement.append(host)
  let hovered: HTMLImageElement | null = null
  let alive = true
  let pending = false
  const buttons = new Map<Element, HTMLButtonElement>()
  const cleanup = () => {
    alive = false
    host.remove()
    clearInterval(timer)
    document.removeEventListener('pointerover', hover, true)
    document.removeEventListener('contextmenu', context, true)
    document.removeEventListener('scroll', schedule, true)
    window.removeEventListener('resize', schedule)
    try { browser.runtime.onMessage.removeListener(onMessage) } catch { /* Old contexts cannot call extension APIs. */ }
  }
  // The API can throw synchronously before returning a promise after reload.
  const send = async (message: object) => {
    try {
      return await browser.runtime.sendMessage(message)
    } catch (error) {
      if (/context invalidated/i.test(String(error))) {
        alive = false
        clearInterval(timer)
        document.removeEventListener('contextmenu', context, true)
        for (const button of buttons.values()) {
          button.textContent = 'Beast updated — reload this page'
          button.title = 'Refresh this website to reconnect to the updated extension.'
        }
      }
      throw error
    }
  }
  const render = () => {
    pending = false
    if (!alive) return
    const elements: Element[] = [...document.querySelectorAll('video,audio')].slice(0, 40)
    if (hovered?.isConnected) elements.push(hovered)
    const shown = new Set<Element>()
    for (const element of elements) {
      const rect = element.getBoundingClientRect()
      if (rect.width < 60 || rect.height < 25 || rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth) continue
      if (getComputedStyle(element).visibility === 'hidden') continue
      shown.add(element)
      let button = buttons.get(element)
      if (!button) {
        button = document.createElement('button')
        button.type = 'button'
        const kind = element.tagName.toLowerCase() === 'img' ? 'image' : element.tagName.toLowerCase()
        button.textContent = `↓ Download ${kind}`
        button.title = 'Open Beast quality and download options'
        button.addEventListener('click', (event) => {
          if (!event.isTrusted) return
          event.preventDefault()
          event.stopPropagation()
          void send({ type: 'open-media', kind, ...clickedMedia(element) }).catch(() => {
            if (button) { button.textContent = 'Beast updated — reload this page'; button.title = 'Refresh this website. If this persists, reload Beast in your browser extensions page.' }
          })
        })
        root.append(button)
        buttons.set(element, button)
      }
      button.style.top = `${Math.max(4, Math.min(innerHeight - 36, rect.top + 6))}px`
      button.style.left = `${Math.max(4, Math.min(innerWidth - 160, rect.right - 160))}px`
    }
    for (const [element, button] of buttons) {
      if (!shown.has(element)) { button.remove(); buttons.delete(element) }
    }
  }
  const schedule = () => {
    if (alive && !pending) { pending = true; requestAnimationFrame(render) }
  }
  const hover = (event: Event) => {
    const target = event.target
    if (target === host) return
    hovered = target instanceof HTMLImageElement ? target : null
    schedule()
  }
  document.addEventListener('pointerover', hover, true)
  const context = (event: Event) => {
    if (event.isTrusted && event.target instanceof Element && event.target.matches('img,video,audio')) {
      void send({ type: 'context-media', ...clickedMedia(event.target) }).catch(() => {})
    }
  }
  document.addEventListener('contextmenu', context, true)
  document.addEventListener('scroll', schedule, true)
  window.addEventListener('resize', schedule)
  const onMessage = (message: { type?: string }) => {
    if (message?.type === 'remove-overlay') cleanup()
  }
  browser.runtime.onMessage.addListener(onMessage)
  const timer = setInterval(schedule, 1500)
  schedule()
})
