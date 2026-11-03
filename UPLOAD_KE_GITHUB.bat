@echo off
title Upload RemoteExambro ke GitHub
cd /d "%~dp0"

echo ========================================================
echo        🚀 PANDUAN CEPAT UPLOAD KE GITHUB
echo ========================================================
echo.
echo Pastikan Anda sudah membuat repository kosong di GitHub!
echo Contoh URL: https://github.com/username/RemoteExambro.git
echo.

set /p REPO_URL="Masukkan URL Repository GitHub Anda: "

if "%REPO_URL%"=="" (
    echo [ERROR] URL repository tidak boleh kosong!
    pause
    exit /b
)

echo.
echo [1/5] Menginisialisasi Git...
if not exist ".git" (
    git init
)

echo [2/5] Menyiapkan branch utama 'main'...
git branch -M main

echo [3/5] Menambahkan seluruh file proyek...
git add .

echo [4/5] Membuat commit pertama...
git commit -m "Initial commit: RemoteExambro - Sistem Remote Otomasi ExamBrowser & Agen Klien"

echo [5/5] Menghubungkan ke GitHub dan Mengunggah...
git remote remove origin >nul 2>&1
git remote add origin %REPO_URL%
git push -u origin main

echo.
if %errorLevel% equ 0 (
    echo ========================================================
    echo [SUKSES] Proyek RemoteExambro berhasil diupload ke GitHub!
    echo Kunjungi: %REPO_URL%
    echo ========================================================
) else (
    echo.
    echo [INFO] Jika diminta login/token:
    echo Gunakan Personal Access Token (PAT) GitHub sebagai password.
    echo Buat token di: https://github.com/settings/tokens
)

pause
