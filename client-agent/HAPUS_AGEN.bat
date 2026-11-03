@echo off
title Hapus Agen RemoteExambro

net session >nul 2>&1
if %errorLevel% neq 0 (
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

echo Menghentikan proses agen yang berjalan...
taskkill /f /im powershell.exe /fi "WINDOWTITLE eq RemoteExambro*" >nul 2>&1

echo Menghapus tugas otomatis Windows...
schtasks /delete /tn "RemoteExambro_Agent" /f >nul 2>&1

echo Menghapus folder C:\RemoteExambroAgent...
if exist "C:\RemoteExambroAgent" rd /s /q "C:\RemoteExambroAgent"

echo Selesai! Agen RemoteExambro berhasil dicopot.
timeout /t 3
exit /b
