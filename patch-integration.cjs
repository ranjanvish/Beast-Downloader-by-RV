const fs=require('node:fs');
let p='apps/desktop/src/main/ipc/services/app-service.ts',s=fs.readFileSync(p,'utf8');s="import { cp, mkdir } from 'node:fs/promises'\nimport path from 'node:path'\nimport { beastExtensionStatus } from '../../lib/beast-extension'\n"+s;s=s.replace("app, BrowserWindow, dialog", "app, BrowserWindow, dialog, shell");s=s.replace("  @IpcMethod()\n  getVersion",`  @IpcMethod()
  getBeastExtensionStatus(_context: IpcContext) {
    return beastExtensionStatus()
  }

  @IpcMethod()
  async installBeastExtension(_context: IpcContext): Promise<string> {
    const source = app.isPackaged
      ? path.join(process.resourcesPath, 'browser-extension')
      : path.resolve(app.getAppPath(), '../extension/.output/chrome-mv3')
    const destination = path.join(app.getPath('userData'), 'browser-extension')
    await mkdir(destination, { recursive: true })
    await cp(source, destination, { recursive: true, force: true, dereference: false })
    const error = await shell.openPath(destination)
    if (error) throw new Error(error)
    return destination
  }

  @IpcMethod()
  getVersion`);if(!s.includes('installBeastExtension')){s=s.replace('  static readonly groupName = \'app\'',`  static readonly groupName = 'app'
  @IpcMethod()
  getBeastExtensionStatus(_context: IpcContext) { return beastExtensionStatus() }
  @IpcMethod()
  async installBeastExtension(_context: IpcContext): Promise<string> {
    const source = app.isPackaged ? path.join(process.resourcesPath, 'browser-extension') : path.resolve(app.getAppPath(), '../extension/.output/chrome-mv3')
    const destination = path.join(app.getPath('userData'), 'browser-extension')
    await mkdir(destination, { recursive: true })
    await cp(source, destination, { recursive: true, force: true, dereference: false })
    const error = await shell.openPath(destination)
    if (error) throw new Error(error)
    return destination
  }`)}fs.writeFileSync(p,s);
p='apps/desktop/src/renderer/src/router.tsx';s=fs.readFileSync(p,'utf8');s="import { BeastExtensions } from './pages/BeastExtensions'\n"+s;s=s.replace('const aboutRoute =',"const extensionsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/extensions', component: BeastExtensions })\n\nconst aboutRoute =");s=s.replace('  aboutRoute,','  aboutRoute,\n  extensionsRoute,');fs.writeFileSync(p,s);
for(p of ['apps/desktop/src/renderer/src/app-layout.tsx','apps/desktop/src/renderer/src/components/ui/sidebar.tsx']){s=fs.readFileSync(p,'utf8').replace("type Page = 'about'", "type Page = 'extensions' | 'about'");if(p.includes('app-layout')){s=s.replace("  about: '/about',","  extensions: '/extensions',\n  about: '/about',").replace("    case '/about':", "    case '/extensions': return 'extensions'\n    case '/about':")}else{s=s.replace('const items: AppSidebarItem[] = [',"const items: AppSidebarItem[] = [\n    { id: 'extensions', active: currentPage === 'extensions', icon: appSidebarIcons.tools, label: 'Extensions', onClick: () => onPageChange('extensions') },")}fs.writeFileSync(p,s)}
p='apps/desktop/electron-builder.yml';s=fs.readFileSync(p,'utf8').replace('extraResources:',"extraResources:\n  - from: ../extension/.output/chrome-mv3\n    to: browser-extension\n    filter: ['**/*']");fs.writeFileSync(p,s);
p='apps/desktop/package.json';s=fs.readFileSync(p,'utf8').replace('"version": "1.0.1"','"version": "1.1.0"');fs.writeFileSync(p,s);
p='apps/desktop/src/main/index.ts';s=fs.readFileSync(p,'utf8').replace('sandbox: false','sandbox: true');fs.writeFileSync(p,s);
