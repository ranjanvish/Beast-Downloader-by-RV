const fs=require('node:fs');let p='apps/extension/lib/images.ts',s=fs.readFileSync(p,'utf8');const start=s.indexOf('export async function saveBlob('),end=s.indexOf('/** Store-only ZIP',start);s=s.slice(0,start)+`export async function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  try {
    const id = await browser.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false })
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: string) => {
        clearTimeout(timer)
        browser.downloads.onChanged.removeListener(changed)
        if (error) reject(new Error('Browser download failed: ' + error + '. Check the download folder and retry.'))
        else resolve()
      }
      const changed = (event: { id: number; state?: { current?: string }; error?: { current?: string } }) => {
        if (event.id !== id) return
        if (event.state?.current === 'complete') finish()
        if (event.error?.current || event.state?.current === 'interrupted') finish(event.error?.current || 'interrupted')
      }
      const timer = setTimeout(() => finish('timed out'), 60000)
      browser.downloads.onChanged.addListener(changed)
      void browser.downloads.search({ id }).then(items => {
        if (items[0]?.state === 'complete') finish()
        else if (items[0]?.state === 'interrupted') finish(items[0].error || 'interrupted')
      }).catch(() => finish('status unavailable'))
    })
  } finally { URL.revokeObjectURL(url) }
}
`+s.slice(end);fs.writeFileSync(p,s);
p='apps/extension/entrypoints/popup/App.tsx';s=fs.readFileSync(p,'utf8').replace("if(zip&&files.length)await saveBlob(await makeZip(files),'Beast Images/images-'+Date.now()+'.zip')", "if(zip&&files.length){try{await saveBlob(await makeZip(files),'Beast Images/images-'+Date.now()+'.zip')}catch(error){setFailed(urls);throw error}}");s=s.replace("const granted=await browser.permissions.request", "setMessage('Approve website access in your browser to continue.');const granted=await browser.permissions.request").replace('const allowed=await browser.permissions.request',"setMessage('Approve image-host access in your browser to continue.');const allowed=await browser.permissions.request");fs.writeFileSync(p,s);
