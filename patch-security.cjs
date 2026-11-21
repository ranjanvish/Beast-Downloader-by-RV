const fs=require('node:fs');let p='apps/desktop/src/main/ipc/index.ts',s=fs.readFileSync(p,'utf8');s="import path from 'node:path'\nimport { pathToFileURL } from 'node:url'\n"+s;s=s.replace("type IpcMainInvokeEvent, ipcMain", "app, type IpcMainInvokeEvent, ipcMain");s=s.replace('return registerIpcHandle(channel, listener)',`return registerIpcHandle(channel, (event, ...args) => {
    const frame = event.senderFrame
    const expected = app.isPackaged || !process.env.ELECTRON_RENDERER_URL
      ? pathToFileURL(path.join(__dirname, '../renderer/index.html')).href
      : process.env.ELECTRON_RENDERER_URL
    if (!frame || frame !== event.sender.mainFrame || frame.url.split('#')[0].split('?')[0] !== expected.split('#')[0].split('?')[0]) {
      throw new Error('Untrusted IPC sender')
    }
    return listener(event, ...args)
  })`);fs.writeFileSync(p,s);
p='apps/desktop/src/main/index.ts';s=fs.readFileSync(p,'utf8');s=s.replace('  mainWindow.webContents.setWindowOpenHandler((details) => {',`  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow?.webContents.getURL().split('#')[0]
    if (url.split('#')[0] !== current) event.preventDefault()
  })
  mainWindow.webContents.setWindowOpenHandler((details) => {`);fs.writeFileSync(p,s);
