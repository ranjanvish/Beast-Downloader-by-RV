const fs=require('node:fs');const p='apps/desktop/src/main/local-api.ts';let s=fs.readFileSync(p,'utf8');s="import { handleBeastRequest } from './lib/beast-extension'\n"+s;const marker="    if (pathname === '/token') {";s=s.replace(marker,`    if (pathname.startsWith('/beast/')) {
      if (caller.kind !== 'extension' || req.headers.origin !== caller.origin || !extensionTokens.consume(req.headers.authorization?.replace(/^Bearer /, ''), caller.origin)) {
        writeJson(res, 403, { error: 'Approved extension token required' })
        return
      }
      await handleBeastRequest(req, res, pathname, caller.origin)
      return
    }

${marker}`);fs.writeFileSync(p,s);
