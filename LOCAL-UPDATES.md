# Beast local updates

Beast 3.1.0 keeps its installed Windows application, shortcuts, browser integration and user profile. Local updates replace the compiled application archive without running an installer. Electron and installed native dependencies are reused.

`FastBuild.cmd` builds and applies one update. `WatchUpdates.ps1` starts a hidden source watcher. The watcher builds changes to the desktop source, shared packages and build inputs. After the first 3.1.0 update, successful updates increase the patch version (3.1.1, 3.1.2, ...). Failed builds preserve installed code.

Close Beast completely, including its tray icon, to let a prepared update apply. Then launch the usual Beast shortcut. Updates never terminate active downloads. Watcher logs and complete rollback backups are under `work-temp/local-updates` in this source project.

The source folder must remain available. A watcher started at Windows login keeps observing changes; it does not download or execute remote source. Remote installer auto-updates are disabled by the installed `resources/beast-local-updates.json` marker.

Changes requiring a different Electron version or new native dependencies require a runtime rebuild. Browser-extension changes require rebuilding the extension. This update path deliberately reuses the working installed runtime.
