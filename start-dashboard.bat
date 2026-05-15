@echo off
setlocal

cd /d "%~dp0"

if "%PORT%"=="" set "PORT=3000"

echo Starting dashboard at http://127.0.0.1:%PORT%/
echo Press Ctrl+C to stop.
echo.

npm.cmd run dashboard
