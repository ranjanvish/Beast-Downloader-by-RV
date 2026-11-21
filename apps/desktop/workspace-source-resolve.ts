import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** Prefer current workspace sources over stale copied workspace dependencies. */
export function workspaceSourceAliases(desktopRoot: string): Record<string, string> {
  const aliases: [string, string][] = []
  for (const name of ['i18n', 'downloader-core', 'task-queue']) {
    const directory = resolve(desktopRoot, '../../packages', name)
    const manifest = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'))
    for (const [key, target] of Object.entries(manifest.exports)) {
      if (key.includes('*') || typeof target !== 'string') {
        continue
      }
      aliases.push([
        `@vidbee/${name}${key === '.' ? '' : key.slice(1)}`,
        resolve(directory, target)
      ])
    }
  }
  return Object.fromEntries(aliases.sort(([a], [b]) => b.length - a.length))
}
