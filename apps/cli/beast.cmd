@echo off
setlocal
set "BEAST_NODE=%~dp0resources\node\node.exe"
set "BEAST_AGENT=%~dp0beast-agent"
if not exist "%BEAST_NODE%" set "BEAST_NODE=%~dp0resources\resources\node\node.exe"
if not exist "%BEAST_AGENT%\beast-mcp.mjs" set "BEAST_AGENT=%~dp0resources\beast-agent"
if /i "%~1"=="mcp" (
  "%BEAST_NODE%" "%BEAST_AGENT%\beast-mcp.mjs"
) else (
  "%BEAST_NODE%" "%BEAST_AGENT%\beast-agent.mjs" %*
)
exit /b %errorlevel%
