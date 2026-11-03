@echo off
title Atur IP Server Proktor untuk Agen
cd /d "%~dp0"

echo ==========================================================
echo        KONFIGURASI ALAMAT IP SERVER PROKTOR
echo ==========================================================
echo.
echo Masukkan alamat IP komputer Server/Proktor yang menjalankan
echo aplikasi RemoteExambro (misal: 10.10.11.100 atau 10.10.11.200).
echo.
echo Ketik "auto" jika ingin agen mencari server secara otomatis.
echo.

set /p INPUT_IP="Masukkan IP Server Proktor: "

if "%INPUT_IP%"=="" (
    echo [BATAL] Alamat IP tidak boleh kosong.
    pause
    exit /b
)

powershell -Command "$cfg = Get-Content 'config.json' -Raw | ConvertFrom-Json; $cfg.serverIp = '%INPUT_IP%'; $cfg | ConvertTo-Json -Depth 5 | Set-Content 'config.json' -Encoding UTF8"

echo.
echo [SUKSES] Alamat server di config.json telah diubah menjadi: %INPUT_IP%
echo.
pause
