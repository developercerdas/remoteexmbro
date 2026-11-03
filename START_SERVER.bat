@echo off
title RemoteExambro - Master Controller Server
cd /d "%~dp0server"

echo ========================================================
echo        🚀 MENJALANKAN SERVER MASTER CONTROLLER
echo ========================================================
echo.

where node >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] Node.js belum terpasang atau belum masuk PATH!
    echo Silakan install Node.js dari https://nodejs.org/
    pause
    exit /b
)

echo Membuka dashboard di browser dalam 2 detik...
start "" "http://localhost:3000"

node --max-old-space-size=4096 server.js
pause
