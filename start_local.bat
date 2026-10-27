@echo off
chcp 65001 >nul
cd /d "%~dp0"
setlocal
set "PYTHON_CMD=python"
python -c "import sys; assert sys.version_info >= (3,10)" >nul 2>nul
if errorlevel 1 (
  set "PYTHON_CMD=py -3"
  py -3 -c "import sys; assert sys.version_info >= (3,10)" >nul 2>nul
  if errorlevel 1 (
    echo Python 3.10 or newer is required. Install Python and enable Add Python to PATH.
    pause
    exit /b 1
  )
)
if not exist ".venv\Scripts\python.exe" (
  echo Creating local Python environment...
  %PYTHON_CMD% -m venv .venv
  if errorlevel 1 goto failed
)
".venv\Scripts\python.exe" -c "import flask,requests" >nul 2>nul
if errorlevel 1 (
  echo Installing web service dependencies...
  ".venv\Scripts\python.exe" -m pip install -r requirements-mineru.txt
  if errorlevel 1 goto failed
)
set "MINERU_PORT=5500"
set "MINERU_SERVE_APP=1"
echo Open http://127.0.0.1:5500/index.html
echo Keep this window open while using the application.
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:5500/index.html"
".venv\Scripts\python.exe" mineru_server.py
pause
exit /b
:failed
echo Setup failed. Check the error above and your network connection, then run this file again.
pause
exit /b 1
