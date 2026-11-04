@echo off
setlocal enabledelayedexpansion
title RemoteLab Pro - Mode Teknisi (Buka Kunci)

:: Memeriksa hak Administrator (UAC Auto-Elevation)
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [INFO] Meminta hak akses Administrator...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

echo ==========================================================
echo        REMOTELAB PRO - BUKA KUNCI MODE TEKNISI
echo ==========================================================
echo.
echo Sedang membuka kunci proteksi Windows di komputer ini...

:: 1. Buka Izin Instalasi Software Baru (DisableMSI)
reg delete "HKLM\SOFTWARE\Policies\Microsoft\Windows\Installer" /v DisableMSI /f >nul 2>&1

:: 2. Buka Kunci Wallpaper Desktop
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\ActiveDesktop" /v NoChangingWallPaper /f >nul 2>&1
reg delete "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\ActiveDesktop" /v NoChangingWallPaper /f >nul 2>&1
reg delete "HKCU\Software\Policies\Microsoft\Windows\Personalization" /v NoChangingDesktopBackground /f >nul 2>&1
reg delete "HKLM\SOFTWARE\Policies\Microsoft\Windows\Personalization" /v NoChangingDesktopBackground /f >nul 2>&1

:: 3. Hentikan Kunci Layar (jika ada)
taskkill /F /FI "WINDOWTITLE eq LabScreenLock*" >nul 2>&1

:: Refresh System Policy
rundll32.exe user32.dll,UpdatePerUserSystemParameters >nul 2>&1

echo.
echo ==========================================================
echo [SUKSES] MODE TEKNISI AKTIF!
echo - Izin Instalasi Software Baru : DIBUKA (Bebas install)
echo - Kunci Wallpaper Desktop      : DIBUKA (Bebas ganti)
echo ==========================================================
echo.
echo Teknisi dapat menginstal aplikasi yang dibutuhkan sekarang.
echo Setelah selesai, jalankan file KUNCI_KEMBALI_SISWA.bat.
echo.
pause
exit /b
