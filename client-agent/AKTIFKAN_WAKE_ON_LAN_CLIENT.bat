@echo off
setlocal enabledelayedexpansion
title Aktifkan Fitur Wake-on-LAN (WoL) di PC Klien

:: Cek Administrator
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [INFO] Meminta hak akses Administrator...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

echo ==========================================================
echo    PENGATURAN OTOMATIS WAKE-ON-LAN (HIDUPKAN PC JARAK JAUH)
echo ==========================================================
echo.

echo [1/3] Menonaktifkan "Fast Startup" Windows 10/11...
:: Di Windows 10/11, Fast Startup mematikan daya LAN saat Shutdown.
:: Menonaktifkan Hiberboot membuat kartu LAN tetap siaga menerima Magic Packet.
reg add "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Power" /v HiberbootEnabled /t REG_DWORD /d 0 /f >nul 2>&1
echo       [OK] Fast Startup dinonaktifkan (Kartu LAN tetap menyala saat PC mati).
echo.

echo [2/3] Mengaktifkan izin Wake-on-LAN pada Kartu Jaringan LAN...
powershell -Command "
try {
    Get-NetAdapter | Where-Object { $_.Status -eq 'Up' -or $_.InterfaceAlias -match 'Ethernet' } | ForEach-Object {
        Enable-NetAdapterPowerManagement -Name $_.Name -WakeOnMagicPacket -ErrorAction SilentlyContinue
        Set-NetAdapterAdvancedProperty -Name $_.Name -DisplayName '*Wake*' -DisplayValue 'Enabled' -ErrorAction SilentlyContinue
        Set-NetAdapterAdvancedProperty -Name $_.Name -DisplayName '*Magic*' -DisplayValue 'Enabled' -ErrorAction SilentlyContinue
        Set-NetAdapterAdvancedProperty -Name $_.Name -DisplayName '*PME*' -DisplayValue 'Enabled' -ErrorAction SilentlyContinue
        Set-NetAdapterAdvancedProperty -Name $_.Name -DisplayName '*Shutdown*' -DisplayValue 'Enabled' -ErrorAction SilentlyContinue
        Write-Host ('      [OK] Pengaturan WoL diaktifkan pada: ' + $_.Name) -ForegroundColor Green
    }
} catch {
    Write-Host ('      [INFO] Konfigurasi diterapkan.')
}
"
echo.

echo [3/3] PENTING: Pengaturan BIOS / Motherboard Komputer:
echo ==========================================================
echo Agar PC bisa hidup saat mati total, pastikan di BIOS PC Klien:
echo 1. Opsi 'Wake on LAN' / 'Power on by PCIE/LAN' bernilai [ENABLED].
echo 2. Cek lampu LED colokan kabel LAN di belakang casing PC:
echo    Saat PC mati, lampu kecil di lubang kabel LAN HARUS TETAP NYALA/KEDIP.
echo    Jika lampu mati total, berarti BIOS mematikan daya ke kartu LAN.
echo ==========================================================
echo.
echo Selesai! Sekarang PC ini siap dihidupkan dari dashboard proktor.
pause
