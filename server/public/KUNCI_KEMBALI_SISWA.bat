@echo off
setlocal enabledelayedexpansion
title RemoteLab Pro - Mode Siswa (Kunci Lab)

:: Memeriksa hak Administrator (UAC Auto-Elevation)
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [INFO] Meminta hak akses Administrator...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

echo ==========================================================
echo        REMOTELAB PRO - KUNCI KEAMANAN MODE SISWA
echo ==========================================================
echo.
echo Sedang mengunci proteksi Windows untuk siswa di lab ini...

:: 1. Blokir Instalasi Software Baru (DisableMSI = 2)
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\Installer" /v DisableMSI /t REG_DWORD /d 2 /f >nul 2>&1

:: 2. Kunci Wallpaper Desktop (NoChangingWallPaper & NoChangingDesktopBackground)
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\ActiveDesktop" /v NoChangingWallPaper /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\ActiveDesktop" /v NoChangingWallPaper /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKCU\Software\Policies\Microsoft\Windows\Personalization" /v NoChangingDesktopBackground /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\Personalization" /v NoChangingDesktopBackground /t REG_DWORD /d 1 /f >nul 2>&1

:: Refresh System Policy
rundll32.exe user32.dll,UpdatePerUserSystemParameters >nul 2>&1

echo.
echo ==========================================================
echo [SUKSES] MODE SISWA AKTIF & TERKUNCI AMAN!
echo - Izin Instalasi Software Baru  : DIBLOKIR TOTAL
echo - Penggantian Wallpaper Desktop : DIKUNCI PERMANEN
echo ==========================================================
echo.
echo Siswa tidak akan dapat menginstal aplikasi atau mengganti wallpaper.
echo.
pause
exit /b
