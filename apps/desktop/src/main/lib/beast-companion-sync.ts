import { cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'

let companionVersion = ''
let companionReady = false
let syncing: Promise<string> | undefined
export const companionSyncStatus = () => ({ companionVersion, companionReady })

/** Keep the stable unpacked extension folder current; publish its manifest last. */
export function syncBeastCompanion(): Promise<string> {
  if (syncing) {
    return syncing
  }
  syncing = (async () => {
    companionReady = false
    const source = app.isPackaged
      ? path.join(process.resourcesPath, 'browser-extension')
      : path.resolve(app.getAppPath(), '../extension/.output/chrome-mv3')
    const destination = path.join(app.getPath('userData'), 'browser-extension')
    const manifest = await readFile(path.join(source, 'manifest.json'), 'utf8')
    companionVersion = JSON.parse(manifest).version
    await mkdir(destination, { recursive: true })
    await cp(source, destination, {
      recursive: true,
      force: true,
      dereference: false,
      filter: (file) => path.basename(file) !== 'manifest.json'
    })
    const temporary = path.join(destination, 'manifest.next.json')
    await writeFile(temporary, manifest)
    await rename(temporary, path.join(destination, 'manifest.json'))
    companionReady = true
    return destination
  })().finally(() => {
    syncing = undefined
  })
  return syncing
}
