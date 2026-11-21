@echo off
cd /d "%~dp0apps\desktop"
node scripts\fast-update.cjs --apply
pause
