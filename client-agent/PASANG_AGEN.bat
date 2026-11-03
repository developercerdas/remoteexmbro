@echo off
setlocal enabledelayedexpansion
title Pemasang Agen RemoteExambro

:: Memeriksa hak Administrator (UAC Auto-Elevation)
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [INFO] Meminta hak akses Administrator...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

cd /d "%~dp0"

echo ==========================================================
echo        PEMASANGAN OTOMATIS AGEN REMOTEEXAMBRO
echo ==========================================================
echo.

set TARGET_DIR=C:\RemoteExambroAgent

echo [1/4] Membuat direktori di %TARGET_DIR%...
if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"

echo [2/4] Menyalin file agen...
copy /y "agent.ps1" "%TARGET_DIR%\" >nul
copy /y "config.json" "%TARGET_DIR%\" >nul
copy /y "SilentRunner.vbs" "%TARGET_DIR%\" >nul

echo [3/4] Mendaftarkan Jadwal Tugas Windows (Auto-Start saat Siswa Login)...
:: Menghapus task lama jika ada
schtasks /delete /tn "RemoteExambro_Agent" /f >nul 2>&1

:: Mendaftarkan task baru
schtasks /create /tn "RemoteExambro_Agent" /tr "wscript.exe \"%TARGET_DIR%\SilentRunner.vbs\"" /sc onlogon /rl highest /f >nul

echo [4/4] Menjalankan agen di sesi aktif saat ini...
start "" wscript.exe "%TARGET_DIR%\SilentRunner.vbs"
schtasks /run /tn "RemoteExambro_Agent" >nul 2>&1

echo.
echo ==========================================================
echo [SUKSES] Agen RemoteExambro berhasil terpasang dan aktif!
echo Agen akan otomatis berjalan di latar belakang setiap kali PC dinyalakan.
echo ==========================================================
echo.
timeout /t 5
exit /b
