@echo off
title RemoteExambro - Cloudflare Online Tunnel (Akses HP dari Mana Saja)
cd /d "%~dp0server"

echo ========================================================
echo   🌐 MEMBUAT TAUTAN WEBSITE PUBLIK RESMI VIA CLOUDFLARE
echo ========================================================
echo.
echo Pastikan START_SERVER.bat sudah berjalan di jendela lain!
echo.
echo Menghubungkan ke Cloudflare Edge Network...
echo Tautan publik HTTPS akan muncul di bawah ini (berakhiran .trycloudflare.com)
echo Buka tautan tersebut di Google Chrome HP Android Anda.
echo ========================================================
echo.

if exist "cloudflared.exe" (
    cloudflared.exe tunnel --url http://localhost:3000
) else (
    call npx --yes localtunnel --port 3000
)

pause
