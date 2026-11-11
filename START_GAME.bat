@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if errorlevel 1 (
  echo Python 3 was not found. Install Python 3, then run this file again.
  pause
  exit /b 1
)

start "Bbidol Cave Game Server" /min py -m http.server 8000 --bind 127.0.0.1
timeout /t 2 /nobreak >nul
start "" "http://localhost:8000/"
