@echo off
title Jalankan Agen RemoteExambro (Mode Portabel / Debug)
cd /d "%~dp0"
echo Menjalankan agen dalam mode terlihat...
powershell.exe -ExecutionPolicy Bypass -NoProfile -File "agent.ps1"
pause
