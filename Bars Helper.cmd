@echo off
setlocal
chcp 65001 >nul
if exist "%~dp0runtime\node.exe" (
  "%~dp0runtime\node.exe" "%~dp0scripts\launch.mjs" %*
) else (
  node "%~dp0scripts\launch.mjs" %*
)
set "bars_exit=%errorlevel%"
if not "%bars_exit%"=="0" pause
exit /b %bars_exit%
