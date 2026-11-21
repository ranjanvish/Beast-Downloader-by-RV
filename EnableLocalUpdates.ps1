$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$installRoot = Join-Path $env:USERPROFILE 'AppData\Local\Programs\beast-downloader'
if (-not (Test-Path -LiteralPath (Join-Path $installRoot 'resources\beast-local-updates.json'))) {
    throw 'Apply the first local source update before enabling the watcher.'
}
$startupPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'Beast Source Updates.lnk'
$shellClient = New-Object -ComObject WScript.Shell
$shortcut = $shellClient.CreateShortcut($startupPath)
$shortcut.TargetPath = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shortcut.Arguments = '-NoProfile -WindowStyle Hidden -File "' + (Join-Path $projectRoot 'WatchUpdates.ps1') + '"'
$shortcut.WorkingDirectory = $projectRoot
$shortcut.WindowStyle = 7
$shortcut.Description = 'Build local Beast source changes and apply updates after Beast exits'
$shortcut.Save()
$launcher = '@echo off' + "`r`n" + 'call "' + (Join-Path $projectRoot 'FastBuild.cmd') + '"' + "`r`n"
Set-Content -LiteralPath (Join-Path $installRoot 'FastBuild.cmd') -Value $launcher -Encoding ASCII
Set-Content -LiteralPath (Join-Path $installRoot 'master-source.txt') -Value $projectRoot -Encoding UTF8
& (Join-Path $projectRoot 'WatchUpdates.ps1')
Write-Output 'Local Beast updates are enabled at Windows login.'
