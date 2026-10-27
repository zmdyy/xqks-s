@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Local Python environment not found. No managed service was stopped.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" local_launcher.py stop
pause
