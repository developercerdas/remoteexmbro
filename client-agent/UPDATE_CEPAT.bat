@echo off
title Update & Aktifkan Agen RemoteLab Pro
net session >nul 2>&1
if %errorLevel% neq 0 (
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)
cd /d "%~dp0"
echo [1/2] Mengunduh skrip agen terbaru dari server...
powershell -Command "Invoke-WebRequest -Uri 'http://10.10.11.85:3000/agent.ps1' -OutFile 'C:\RemoteExambroAgent\agent.ps1' -TimeoutSec 10"
echo [2/2] Menjalankan agen di latar belakang...
start "" wscript.exe "C:\RemoteExambroAgent\SilentRunner.vbs"
echo.
echo ==========================================================
echo [SUKSES] Agen RemoteLab Pro berhasil aktif kembali!
echo ==========================================================
timeout /t 3
exit /b
