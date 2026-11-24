'use strict'
// Reuse installed Electron/native modules; stage and validate before replacing code.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const desktop = path.resolve(__dirname, '..')
const root = path.resolve(desktop, '../..')
const stateRoot = path.join(root, 'work-temp/local-updates')
const install = path.join(process.env.USERPROFILE, 'AppData/Local/Programs/beast-downloader')
const resources = path.join(install, 'resources')
const base = path.join(resources, 'app.asar')
const watch = process.argv.includes('--watch')
const apply = watch || process.argv.includes('--apply')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex')

function filesIn(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const full = path.join(dir, entry.name)
      if (['node_modules', 'dist', 'out', '.git'].includes(entry.name)) {
        return []
      }
      return entry.isDirectory() ? filesIn(full) : [full]
    })
}
function sourceHash() {
  const digest = crypto.createHash('sha256')
  for (const input of [
    'src',
    'resources',
    'build',
    'electron.vite.config.ts',
    'renderer-react-resolve.ts',
    'workspace-source-resolve.ts',
    'package.json'
  ]
    .map((item) => path.join(desktop, item))
    .concat(
      path.join(root, 'packages'),
      ...['agent-bridge.mjs', 'beast-mcp.mjs', 'beast-agent.mjs', 'beast.cmd', 'BEAST-MCP.md', 'BEAST-AGENT.md'].map((item) =>
        path.join(root, 'apps/cli', item)
      ),
      ...['entrypoints', 'lib', 'public', 'wxt.config.ts'].map((item) =>
        path.join(root, 'apps/extension', item)
      )
    )) {
    if (!fs.existsSync(input)) {
      continue
    }
    for (const file of fs.statSync(input).isDirectory() ? filesIn(input) : [input]) {
      if (file.endsWith('.tsbuildinfo')) {
        continue
      }
      digest.update(path.relative(root, file))
      const stat = fs.statSync(file)
      digest.update(
        stat.size > 2 * 1024 * 1024 ? `${stat.size}:${stat.mtimeMs}` : fs.readFileSync(file)
      )
    }
  }
  return digest.digest('hex')
}
function runNode(script, args, cwd = desktop) {
  const result = spawnSync(process.execPath, [path.join(root, 'node_modules', script), ...args], {
    cwd,
    stdio: 'inherit',
    windowsHide: true
  })
  if (result.status !== 0) {
    throw new Error(`Command failed: ${script} (${result.status})`)
  }
}
function isRunning() {
  const result = spawnSync(
    'tasklist.exe',
    ['/FI', 'IMAGENAME eq beast-downloader.exe', '/FO', 'CSV', '/NH'],
    { encoding: 'utf8', windowsHide: true }
  )
  if (result.status !== 0) {
    throw new Error('Could not check Beast processes')
  }
  return /"beast-downloader\.exe"/i.test(result.stdout)
}
async function buildUpdate(asar, previous) {
  const lock = path.join(stateRoot, 'build.lock')
  if (fs.existsSync(lock)) {
    const owner = Number(fs.readFileSync(lock, 'utf8'))
    try {
      process.kill(owner, 0)
      throw new Error('Another Beast update build is already running')
    } catch (error) {
      if (error.code !== 'ESRCH') {
        throw error
      }
    }
    fs.unlinkSync(lock)
  }
  const handle = fs.openSync(lock, 'wx')
  fs.writeFileSync(handle, String(process.pid))
  fs.closeSync(handle)
  try {
    return await buildUpdateUnlocked(asar, previous)
  } finally {
    if (fs.readFileSync(lock, 'utf8') === String(process.pid)) {
      fs.unlinkSync(lock)
    }
  }
}
async function buildUpdateUnlocked(asar, previous) {
  const manifestPath = path.join(desktop, 'package.json')
  const original = fs.readFileSync(manifestPath, 'utf8')
  const manifest = JSON.parse(original)
  if (previous?.version === manifest.version && !process.argv.includes('--same-version')) {
    const parts = manifest.version.split('.').map(Number)
    parts[2] += 1
    manifest.version = parts.join('.')
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  const fingerprint = sourceHash()
  const stage = path.join(stateRoot, `stage-${Date.now()}`)
  const content = path.join(stage, 'content')
  fs.mkdirSync(content, { recursive: true })
  try {
    runNode('typescript/bin/tsc', ['--noEmit', '-p', 'tsconfig.node.json', '--composite', 'false'])
    runNode('electron-vite/bin/electron-vite.js', ['build'])
    runNode('wxt/bin/wxt.mjs', ['build'], path.join(root, 'apps/extension'))
    const companionDirectory = path.join(stage, 'browser-extension')
    fs.cpSync(path.join(root, 'apps/extension/.output/chrome-mv3'), companionDirectory, {
      recursive: true
    })
    const companionManifest = path.join(companionDirectory, 'manifest.json')
    const companion = JSON.parse(fs.readFileSync(companionManifest, 'utf8'))
    companion.version = manifest.version
    fs.writeFileSync(companionManifest, JSON.stringify(companion, null, 2))
    const agentDirectory = path.join(stage, 'beast-agent')
    fs.mkdirSync(agentDirectory)
    for (const name of ['agent-bridge.mjs', 'beast-mcp.mjs', 'beast-agent.mjs', 'BEAST-MCP.md', 'BEAST-AGENT.md']) {
      fs.copyFileSync(path.join(root, 'apps/cli', name), path.join(agentDirectory, name))
    }
    const baseHeader = asar.getRawHeader(base).header
    const reuseUnpacked = baseHeader.files.node_modules?.unpacked === true
    if (reuseUnpacked) {
      // Installed native dependencies are immutable during source-only updates.
      for (const name of Object.keys(baseHeader.files)) {
        if (name === 'node_modules' || name === 'out') {
          continue
        }
        if (baseHeader.files[name].files) {
          throw new Error(`Unexpected application directory: ${name}`)
        }
        fs.writeFileSync(path.join(content, name), asar.extractFile(base, name))
      }
    } else {
      asar.extractAll(base, content)
    }
    const oldOut = path.join(content, 'out')
    // A fixed child of this newly-created staging directory.
    fs.rmSync(oldOut, { recursive: true, force: true })
    fs.cpSync(path.join(desktop, 'out'), oldOut, {
      recursive: true,
      filter: (name) => !name.endsWith('.map')
    })
    const packagePath = path.join(content, 'package.json')
    const installed = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
    installed.version = manifest.version
    fs.writeFileSync(packagePath, JSON.stringify(installed, null, 2))
    const streams = []
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name)
        const relative = path.relative(content, file)
        const stat = fs.lstatSync(file)
        if (stat.isSymbolicLink()) {
          throw new Error(`Unexpected update link: ${relative}`)
        }
        streams.push({
          path: relative,
          type: entry.isDirectory() ? 'directory' : 'file',
          stat,
          unpacked: relative === 'node_modules' || relative.startsWith(`node_modules${path.sep}`),
          streamGenerator: () => fs.createReadStream(file)
        })
        if (entry.isDirectory()) {
          walk(file)
        }
      }
    }
    walk(content)
    const archive = path.join(stage, 'app.asar')
    await asar.createPackageFromStreams(archive, streams)
    if (reuseUnpacked) {
      const { Pickle } = require('@electron/asar/lib/pickle')
      const generated = asar.getRawHeader(archive)
      generated.header.files.node_modules = baseHeader.files.node_modules
      const header = Pickle.createEmpty()
      header.writeString(JSON.stringify(generated.header))
      const headerBytes = header.toBuffer()
      const size = Pickle.createEmpty()
      size.writeUInt32(headerBytes.length)
      const bytes = fs.readFileSync(archive).subarray(8 + generated.headerSize)
      fs.writeFileSync(archive, Buffer.concat([size.toBuffer(), headerBytes, bytes]))
      asar.uncache(archive)
    }
    if (!asar.statFile(archive, path.join('out', 'main', 'index.js')).size) {
      throw new Error('Update is incomplete')
    }
    return {
      stage,
      archive,
      companionDirectory,
      agentDirectory,
      reuseUnpacked,
      version: manifest.version,
      fingerprint,
      sha256: sha256(fs.readFileSync(archive))
    }
  } catch (error) {
    fs.writeFileSync(manifestPath, original)
    throw error
  }
}
async function applyUpdate(update) {
  if (isRunning()) {
    console.log('Update ready; waiting for Beast to exit completely, including its tray icon.')
  }
  while (isRunning()) {
    await sleep(2000)
  }
  const backup = path.join(stateRoot, `backup-${Date.now()}`)
  fs.mkdirSync(backup, { recursive: true })
  const unpacked = `${base}.unpacked`
  fs.copyFileSync(base, path.join(backup, 'app.asar'))
  if (!update.reuseUnpacked && fs.existsSync(unpacked)) {
    fs.cpSync(unpacked, path.join(backup, 'app.asar.unpacked'), { recursive: true })
  }
  const oldUnpacked = `${unpacked}.previous-${Date.now()}`
  const companionDirectory = path.join(resources, 'browser-extension')
  const companionBackup = path.join(backup, 'browser-extension')
  const agentDirectory = path.join(resources, 'beast-agent')
  const agentBackup = path.join(backup, 'beast-agent')
  let agentInstalled = false
  fs.copyFileSync(update.archive, `${base}.incoming`)
  try {
    if (isRunning()) {
      throw new Error('Beast restarted before update application')
    }
    if (update.companionDirectory) {
      if (fs.existsSync(companionDirectory)) {
        fs.renameSync(companionDirectory, companionBackup)
      }
      fs.cpSync(update.companionDirectory, companionDirectory, { recursive: true })
    }
    if (update.agentDirectory) {
      if (fs.existsSync(agentDirectory)) {
        fs.renameSync(agentDirectory, agentBackup)
      }
      agentInstalled = true
      fs.cpSync(update.agentDirectory, agentDirectory, { recursive: true })
    }
    if (!update.reuseUnpacked) {
      if (fs.existsSync(unpacked)) {
        fs.renameSync(unpacked, oldUnpacked)
      }
      fs.cpSync(`${update.archive}.unpacked`, unpacked, { recursive: true })
    }
    fs.renameSync(`${base}.incoming`, base)
    fs.writeFileSync(
      path.join(resources, 'beast-local-updates.json'),
      JSON.stringify(
        {
          version: update.version,
          source: root,
          updatedAt: new Date().toISOString(),
          sha256: update.sha256
        },
        null,
        2
      )
    )
    const stateFile = path.join(stateRoot, 'state.json')
    fs.writeFileSync(`${stateFile}.incoming`, JSON.stringify({ ...update, backup }, null, 2))
    fs.renameSync(`${stateFile}.incoming`, stateFile)
    console.log(`Installed Beast ${update.version}. Backup: ${backup}`)
  } catch (error) {
    fs.copyFileSync(path.join(backup, 'app.asar'), base)
    if (fs.existsSync(companionBackup)) {
      if (fs.existsSync(companionDirectory)) {
        fs.renameSync(companionDirectory, `${companionDirectory}.failed-${Date.now()}`)
      }
      fs.renameSync(companionBackup, companionDirectory)
    }
    if (agentInstalled) {
      if (fs.existsSync(agentDirectory)) {
        fs.renameSync(agentDirectory, `${agentDirectory}.failed-${Date.now()}`)
      }
      if (fs.existsSync(agentBackup)) {
        fs.renameSync(agentBackup, agentDirectory)
      }
    }
    if (fs.existsSync(oldUnpacked)) {
      if (fs.existsSync(unpacked)) {
        fs.renameSync(unpacked, `${unpacked}.failed-${Date.now()}`)
      }
      fs.renameSync(oldUnpacked, unpacked)
    }
    throw error
  }
}
async function main() {
  const asar = await import('@electron/asar')
  fs.mkdirSync(stateRoot, { recursive: true })
  if (!fs.existsSync(base)) {
    throw new Error('Installed Beast was not found')
  }
  const prepared = process.argv
    .find((value) => value.startsWith('--prepared='))
    ?.slice('--prepared='.length)
  if (prepared) {
    const archive = path.resolve(prepared)
    if (!asar.statFile(archive, path.join('out', 'main', 'index.js')).size) {
      throw new Error('Update is incomplete')
    }
    const manifest = JSON.parse(asar.extractFile(archive, 'package.json').toString())
    const installedModules = asar.getRawHeader(base).header.files.node_modules
    const preparedModules = asar.getRawHeader(archive).header.files.node_modules
    const reuseUnpacked =
      !fs.existsSync(`${archive}.unpacked`) && installedModules?.unpacked === true
    if (reuseUnpacked && JSON.stringify(installedModules) !== JSON.stringify(preparedModules)) {
      throw new Error('The prepared update does not match the installed native dependencies')
    }
    const companionDirectory = path.join(path.dirname(archive), 'browser-extension')
    const agentDirectory = path.join(path.dirname(archive), 'beast-agent')
    await applyUpdate({
      archive,
      reuseUnpacked,
      companionDirectory: fs.existsSync(companionDirectory) ? companionDirectory : undefined,
      agentDirectory: fs.existsSync(agentDirectory) ? agentDirectory : undefined,
      stage: path.dirname(archive),
      version: manifest.version,
      fingerprint: sourceHash(),
      sha256: sha256(fs.readFileSync(archive))
    })
    return
  }
  const lock = path.join(stateRoot, 'watcher.lock')
  if (watch) {
    if (fs.existsSync(lock)) {
      try {
        process.kill(Number(fs.readFileSync(lock, 'utf8')), 0)
        throw new Error('Update watcher is already running')
      } catch (error) {
        if (error.code !== 'ESRCH') {
          throw error
        }
      }
    }
    fs.writeFileSync(lock, String(process.pid))
    process.on('exit', () => {
      if (fs.existsSync(lock) && fs.readFileSync(lock, 'utf8') === String(process.pid)) {
        fs.unlinkSync(lock)
      }
    })
  }
  let previous = fs.existsSync(path.join(stateRoot, 'state.json'))
    ? JSON.parse(fs.readFileSync(path.join(stateRoot, 'state.json'), 'utf8'))
    : null
  let attempted = previous?.fingerprint
  if (watch) {
    console.log(`Watching source changes for Beast ${previous?.version ?? '3.1.0'}`)
  }
  do {
    let fingerprint
    try {
      fingerprint = sourceHash()
      const stateFile = path.join(stateRoot, 'state.json')
      if (watch && fs.existsSync(stateFile)) {
        const latest = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
        if (latest.sha256 !== previous?.sha256) {
          previous = latest
          if (fingerprint === latest.fingerprint) {
            attempted = fingerprint
          }
        }
      }
    } catch (error) {
      if (!watch) {
        throw error
      }
      console.error('Source files are changing; retrying the scan shortly.', error.message)
      await sleep(5000)
      continue
    }
    if (fingerprint !== attempted || !watch) {
      if (watch) {
        await sleep(2000)
        try {
          if (sourceHash() !== fingerprint) {
            continue
          }
        } catch {
          continue
        }
      }
      attempted = fingerprint
      try {
        const update = await buildUpdate(asar, previous)
        if (apply) {
          await applyUpdate(update)
          previous = update
          attempted = update.fingerprint
        } else {
          console.log(`Prepared ${update.version}: ${update.archive}`)
        }
      } catch (error) {
        console.error(error)
        if (!watch) {
          throw error
        }
        console.error('Waiting for the next source change. Installed code was preserved.')
      }
    }
    if (watch) {
      await sleep(5000)
    }
  } while (watch)
}
module.exports = { sourceHash, isRunning }
if (require.main === module) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
