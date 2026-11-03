@echo off
title Diagnostik Koneksi Klien ke Server RemoteExambro
cd /d "%~dp0"

echo ==========================================================
echo       DIAGNOSTIK KONEKSI KE SERVER REMOTEEXAMBRO
echo ==========================================================
echo.

set SERVER_IP=10.10.11.85
set SERVER_PORT=3000

echo [1/3] Memeriksa IP Komputer Klien ini...
ipconfig | findstr /i "IPv4 Address IPv4"
echo.

echo [2/3] Menguji PING ke Server Proktor (%SERVER_IP%)...
ping -n 2 %SERVER_IP%
if %errorlevel% neq 0 (
    echo.
    echo [PERINGATAN] Ping ke %SERVER_IP% GAGAL / Request Timed Out.
    echo Pastikan kabel LAN tercolok ke switch yang sama dengan server proktor!
) else (
    echo [OK] Kabel dan jalur jaringan ke server proktor TERHUBUNG!
)
echo.

echo [3/3] Menguji Akses Port Web Server (http://%SERVER_IP%:%SERVER_PORT%/api/info)...
powershell -Command "try { $res = Invoke-RestMethod -Uri 'http://%SERVER_IP%:%SERVER_PORT%/api/info' -TimeoutSec 3; Write-Host '[SUKSES] Terhubung ke Server RemoteExambro!' -ForegroundColor Green; Write-Host 'Detail Server: ' ($res | ConvertTo-Json -Compress) } catch { Write-Host '[GAGAL] Tidak dapat menghubungi server web proktor: ' $_.Exception.Message -ForegroundColor Red; Write-Host 'Kemungkinan Windows Firewall di PC server proktor memblokir port 3000 atau IP server salah.' -ForegroundColor Yellow }"

echo.
echo ==========================================================
echo Jalankan juga file JALANKAN_SEMENTARA.bat untuk melihat
echo jalannya agen secara langsung.
echo ==========================================================
pause
