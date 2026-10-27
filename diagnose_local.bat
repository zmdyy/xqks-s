@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"
call setup_local.bat
if errorlevel 1 exit /b 1
".venv\Scripts\python.exe" local_launcher.py diagnose
pause
