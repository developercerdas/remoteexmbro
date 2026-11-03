@echo off
title RemoteExambro - Online Public Tunnel (Akses dari HP / Luar Lab)
cd /d "%~dp0"

echo ========================================================
echo   🌐 MEMBUAT TAUTAN WEBSITE PUBLIK UNTUK HP ANDROID
echo ========================================================
echo.
echo Pastikan START_SERVER.bat sudah berjalan di jendela lain!
echo.
echo Membuka tunnel online gratis melalui LocalTunnel...
echo.

call npx --yes localtunnel --port 3000

pause
