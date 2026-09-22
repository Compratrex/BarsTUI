@echo off
setlocal
chcp 65001 >nul
if exist "%~dp0runtime\node.exe" (
  "%~dp0runtime\node.exe" "%~dp0scripts\install-command.mjs" %*
) else (
  node "%~dp0scripts\install-command.mjs" %*
)
set "bars_exit=%errorlevel%"
pause
exit /b %bars_exit%
