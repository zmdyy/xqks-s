@echo off
setlocal DisableDelayedExpansion
cd /d "%~dp0"
rem Compatibility entry. Use start_system.vbs to avoid even a brief console flash.
wscript.exe "%~dp0start_system.vbs"
