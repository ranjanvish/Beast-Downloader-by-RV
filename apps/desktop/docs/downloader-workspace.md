# Downloader workspace map

## Screen and components

| Visible area | Source | Stable selector |
| --- | --- | --- |
| App heading and previous library | `src/renderer/src/pages/Home.tsx` | `.beast-hero` |
| Mixed URL input, fetching, queue actions | `src/renderer/src/components/download/AllInOneDownloads.tsx` | `[data-ui="queue-actions"]` |
| Shared defaults for selected rows | same file | `[data-ui="bulk-settings"]` |
| Search and type/status filter | same file | `[data-ui="queue-filters"]` |
| Compact row / click-to-expand options | `BatchRow` in same file | `[data-ui="media-card"][data-media-kind]`, `[data-ui="item-details"]`, `[data-ui="item-options"]` |
| Thumbnail, viewer, audio/video playback | `components/download/workspace/ItemPreview.tsx` | `[data-ui="media-preview"]`, `.beast-preview-dialog` |
| Text timestamps and start/end sliders | `components/download/workspace/TrimRangeEditor.tsx` | `[data-ui="trim-editor"]` |
| Layout, transitions and responsive behavior | `components/download/workspace/workspace.css` | semantic classes above |
| App-wide green palette (light and dark) | `src/renderer/src/assets/global.css` | final `:root` and `.dark` token blocks |
| Translatable wording | `packages/i18n/src/locales/*.json` | `batch.*`, `workspace.*` |

All paths are relative to `apps/desktop` unless starting with `packages/`.

## Data and behavior

- `src/shared/mixed-download.ts`: item schema, real format selection, timestamp parsing/formatting, validation, conversion to existing download options.
- `src/main/lib/mixed-batch.ts`: metadata workers, item lifecycle, restore, bulk edits, bounded download admission. UI changes must not replace its scheduler.
- `src/main/lib/mixed-batch-host.ts`: atomic workspace persistence and integration with the existing download engine.
- `src/main/ipc/services/mixed-batch-service.ts`: typed `batch.snapshot`, `batch.execute`, `batch.preview` calls.
- `src/main/lib/mixed-preview.ts`: lazy fresh metadata, memory-only signed stream URLs, owned-item protocol access, local-file playback, public-host and redirect validation. Preview metadata is not saved with the workspace.
- `batch-media://<item-id>/saved|image|video|audio`: main-process streaming, native range requests and seek support. Only files belonging to workspace entries are exposed.
- `src/main/local-api.ts`: authenticated automation equivalents under `/automation/v1/batch/*`.

## Preview policy and transport

`src/renderer/index.html` contains the HTML meta CSP; `src/main/lib/renderer-csp.ts` supplies and merges response-header CSP. Both must allow `batch-media:` in `img-src`, `media-src` and `connect-src`. Test both policies together without a CSP bypass. Remote preview streams use Node fetch to inspect manual redirects; Chromium net.fetch cancels these redirects. Validate each redirect destination before following it. Keep Electron net.fetch for owned local files.

## Contracts to preserve

1. Text fields and sliders submit the same atomic `{ start, end }` patch. Empty times mean full length; values accept seconds or HH:MM:SS with decimals. The main-process validator remains authoritative.
2. Sliders appear only with a known positive duration. The UI clamps crossing handles and rejects out-of-bounds typed ranges. Editing is disabled for admitted jobs.
3. Resolution, language and audio output remain explicit per-item choices. Storyboards are never audio tracks.
4. Previews open on demand. Closing the dialog unmounts players; preview failures never cancel or modify download jobs. Split audio/video previews synchronize seeking, playback and volume.
5. Existing downloaded files take precedence for preview. Remote previews depend on the source allowing playback and browser codec support; show retry/local-file guidance on failure.
6. Rows use a native closed-by-default details/summary disclosure. Expanding reveals the original controls; closing keeps their state. Thumbnail playback and selection must not toggle the disclosure.
7. Batch fetching, deduplication, mixed media, per-item/bulk options, pagination and persistent results remain independent of visual styling.
8. Keep motion subtle and honor reduced motion. Dialogs use the shared accessible dialog primitive and native media controls.

## Verification

- `pnpm --config.verifyDepsBeforeRun=false run check`
- `node --test apps/desktop/scripts/test-mixed-batch.cjs`
- `node apps/desktop/scripts/test-workspace-ui.cjs` (hidden Electron window; no desktop interaction)
- `node --test apps/desktop/scripts/test-mixed-preview.cjs`
- `node apps/desktop/scripts/test-preview-streaming.cjs` (real Electron protocol, local image/audio/video and remote Pexels byte ranges/playback)
- Installer-free delivery: `node apps/desktop/scripts/fast-update.cjs --same-version`, then apply its prepared archive only when idle. `WatchUpdates.ps1` resumes source watching.

## Downloads section and default destination

- Sidebar `/downloads`: `src/renderer/src/pages/Downloads.tsx`; All/Video/Image/Audio tabs, live status, search, pagination, preview, open file and reveal folder.
- Shared header destination control: `components/download/workspace/DownloadFolderControl.tsx`, selector `[data-ui="default-download-folder"]`. Uses existing `settings.downloadPath` via typed settings IPC and Jotai atom. Cancellation and save errors preserve the previous value.
- Library contract/filtering: `src/shared/download-library.ts`; 30 rows per page, counts by actual output media type.
- Library aggregation: `src/main/lib/download-library.ts`; shared queue entries plus image history and queued image jobs. Task IDs prevent duplicate workspace entries. Metadata-only ready/fetch-error rows stay in Home.
- Image history: `src/main/lib/download-library-store.ts`, atomic `userData/image-download-history.json`. Image saves record immediately, so removing Home entries does not erase download history. Previously completed workspace images migrate on load.
- Destinations: an explicit per-item folder overrides `settings.downloadPath`; otherwise all media types use that global folder. A destination change affects newly admitted jobs and never moves saved files or rewrites already-running jobs.
- Library-owned preview IDs resolve to existing queue/image records; arbitrary file paths are never accepted as preview IDs.
- Verification: `test-download-library.cjs` checks persistence after workspace cleanup/restart, category counts, large pagination, deduplication and folder precedence. `test-download-library-ui.cjs` checks category tabs, picker cancellation and failed-save behavior in an isolated hidden window.

## Wikimedia file-page images

`image-page-parser.ts` treats `commons.wikimedia.org/wiki/File:*` as one media asset. It reads the original URL from `.fullMedia a.internal`, uses `.fullImageLink img` for a dedicated `ImageSource.previewUrl`, and preserves advertised resolutions as variants. Header/footer logos, tracking pixels, navigation and license badges never become downloadable rows for these pages. Missing file pages fail clearly instead of presenting site branding as media.

`ItemPreview.tsx` and the owned-image viewer prefer `previewUrl`; download size stays bound to `options.imageUrl`. This avoids repeatedly fetching the original file merely to display a small card, including originals subject to rate limiting. `test-commons-images.cjs` verifies the three supplied photo pages; `test-preview-streaming.cjs --commons` verifies their viewer decoding under production CSP.
