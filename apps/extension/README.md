# Beast Browser Companion 1.3.1

Build: `pnpm --filter vidbee-extension build`. Type check: `pnpm --filter vidbee-extension compile`.
Build the extension BEFORE packaging the Windows desktop application. Electron Builder includes `.output/chrome-mv3` as `resources/browser-extension`.

Private installation: desktop **Extensions → Copy extension setup path**, then open your browser's extensions page, enable Developer mode and Load unpacked using the copied path. No Explorer window opens. Chrome, Edge, Brave and Opera are targets. No store upload has been made. Automatic local installation or an Enable prompt is not implemented; ordinary Windows Chrome requires store-backed distribution for the external-install route.

Enable floating download buttons in the companion and approve optional website access once. Visible HTML video/audio players receive a button; images receive a button on hover. Buttons update for dynamic pages and scroll positions. Click opens the chooser with automatic metadata analysis, including available languages, but never queues a download without confirmation. Separate image/video/audio context menus are available even with floating buttons disabled. Clicked media use the nearest unambiguous card permalink or exact media source. A blob source falls back only to a recognized individual-media page; otherwise the chooser asks the user to open the individual post. It never substitutes a generic homepage. Canvas players, closed shadow DOM, browser pages, invisible audio and DRM may not expose a usable source. A direct media file may expose only one original quality.

The stable development ID comes from the public key in beast-identity.json. Keep the desktop allowlist synchronized if it changes. No private signing key or IDM code is included.

Architecture: optional site permissions, click-triggered DOM scan, tab-scoped webRequest media discovery, isolated extension UI, approved-origin loopback handshake with expiring one-use tokens, short-lived server-side metadata tickets. Metadata is projected before returning to the browser. The browser cannot supply raw process arguments or download filesystem paths.

Images save through the browser Downloads API. Original raster images and PNG/JPEG/WebP conversion are supported; conversion flattens animation and JPEG uses white for transparency. ZIP uses bounded, store-only entries. Source URLs requiring redirects, unsupported types or unauthenticated inaccessible images may fail and can be retried individually.

Open full view for image batches. Network detection requests broad optional website access but only records in tabs explicitly armed. Use the privacy panel to revoke optional hosts and clear capture. No telemetry, cookie collection or automatic file execution is added by this extension.

Security scope: protection against untrusted web-page requests; not protection against malware already running as the same OS user. DNS validation covers initial desktop source URLs, not every downstream URL that third-party extractors may follow. No DRM bypass or all-site guarantee. A full independent security audit has not been performed.

Version 1.3 adds an editing-compatible MP4 checkbox (H.264 yuv420p, constant 30 fps, AAC 48 kHz stereo, original retained), an MP3 checkbox, elapsed progress and connection/reload recovery controls. PNG/JPEG controls use advertised source variants with fallback; native browser decoding falls back to the bounded local ImageMagick converter for supported HEIC/TIFF/RAW formats. Desktop rejects SVG; the browser accepts only passive self-contained SVG.

The desktop refreshes userData/browser-extension at startup and publishes its manifest last. The companion checks /status once a minute and reloads for a changed bundled version while idle; busy panels defer reload. Developer mode must remain enabled. Users upgrading from 1.2 must manually reload once to load the new updater. Copies loaded from unrelated ZIP folders do not auto-sync.

1.3.1 fixes dedicated generic media page fallback, audio-only formats with an unspecified codec, and synchronous context-invalidated errors in stale overlays. Existing website tabs still need refreshing after an extension reload.
