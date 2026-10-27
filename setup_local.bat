@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" goto checkenv
set "PYTHON_CMD=python"
python -c "import sys; assert sys.version_info >= (3,10)" >nul 2>nul
if not errorlevel 1 goto createenv
set "PYTHON_CMD=py -3"
py -3 -c "import sys; assert sys.version_info >= (3,10)" >nul 2>nul
if errorlevel 1 (
  echo Python 3.10 or newer is required. Install Python and enable Add Python to PATH.
  goto failed
)
:createenv
echo Creating local Python environment...
%PYTHON_CMD% -m venv .venv
if errorlevel 1 goto failed
:checkenv
".venv\Scripts\python.exe" -c "import sys; assert sys.version_info >= (3,10)" >nul 2>nul
if errorlevel 1 (
  echo The existing .venv is invalid or uses an older Python. Rename .venv and try again.
  goto failed
)
".venv\Scripts\python.exe" -c "import flask,requests" >nul 2>nul
if not errorlevel 1 exit /b 0
echo Installing local web service dependencies...
".venv\Scripts\python.exe" -m pip install -r requirements-mineru.txt
if errorlevel 1 goto failed
exit /b 0
:failed
echo Setup failed. Check the message above, Python installation and network connection.
pause
exit /b 1
