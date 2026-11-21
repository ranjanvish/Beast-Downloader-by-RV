$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$nodePath = (Get-Command node.exe).Source
$scriptPath = Join-Path $projectRoot 'apps\desktop\scripts\fast-update.cjs'
$logRoot = Join-Path $projectRoot 'work-temp\local-updates'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$lockPath = Join-Path $logRoot 'watcher.lock'
if (Test-Path -LiteralPath $lockPath) {
    $watcherId = [int](Get-Content -LiteralPath $lockPath -Raw)
    if (Get-Process -Id $watcherId -ErrorAction SilentlyContinue) { exit 0 }
}
Start-Process -FilePath $nodePath -ArgumentList @(('"' + $scriptPath + '"'), '--watch') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logRoot 'watcher.log') -RedirectStandardError (Join-Path $logRoot 'watcher-error.log')
