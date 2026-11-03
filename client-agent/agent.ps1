<#
.SYNOPSIS
    RemoteExambro Client Agent
    Agen Latar Belakang Klien Ujian / Siswa untuk Otomasi ExamBrowser
.DESCRIPTION
    Berkomunikasi dengan Master Controller Server RemoteExambro.
    Menyediakan otomasi:
    - Buka & Auto-RUN ExamBrowser (Standar & Webcam)
    - Auto klik tombol OK pada popup update
    - Auto klik Yes/Ya pada prompt izin webcam
    - Tutup aman via kombinasi tombol Ctrl + C + B
    - Force kill darurat
    - Remote shutdown & restart dengan pesan peringatan
    - Screenshot thumbnail layar klien
    - Auto-discovery server via UDP broadcast
#>

[CmdletBinding()]
param(
    [string]$ConfigPath = ""
)

# Tentukan lokasi script dan config.json secara aman tanpa error null Path
$ScriptDirectory = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $ScriptDirectory) { $ScriptDirectory = (Get-Location).Path }
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
    $ConfigPath = Join-Path $ScriptDirectory "config.json"
}

# Set TLS security protocol
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls11 -bor [Net.SecurityProtocolType]::Tls

# Load Assemblies
Add-Type -AssemblyName UIAutomationClient -ErrorAction SilentlyContinue
Add-Type -AssemblyName UIAutomationTypes -ErrorAction SilentlyContinue
Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
Add-Type -AssemblyName System.Drawing -ErrorAction SilentlyContinue

# Inisialisasi Win32 API Helpers
$win32Code = @"
using System;
using System.Text;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public class Win32 {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumChildWindows(IntPtr hWndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr SendMessage(IntPtr hWnd, int Msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, int dwFlags, int dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    public const int BM_CLICK = 0x00F5;
    public const int MOUSEEVENTF_LEFTDOWN = 0x02;
    public const int MOUSEEVENTF_LEFTUP = 0x04;
    public const int KEYEVENTF_KEYUP = 0x02;

    public static void ClickAt(int x, int y) {
        SetCursorPos(x, y);
        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
    }

    private static bool MatchesAny(string text, string[] options) {
        foreach (var opt in options) {
            if (text.Equals(opt.Trim(), StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    public static bool ClickAnyDialogButton(string buttonLabels) {
        var opts = buttonLabels.Split('|');
        bool success = false;

        EnumWindows((h, l) => {
            if (!IsWindowVisible(h)) return true;
            IntPtr targetBtn = IntPtr.Zero;
            EnumChildWindows(h, (child, l2) => {
                var btnTxt = new StringBuilder(512);
                GetWindowText(child, btnTxt, 512);
                var btnCls = new StringBuilder(64);
                GetClassName(child, btnCls, 64);

                string cleanTxt = btnTxt.ToString().Replace("&", "").Trim();
                if (btnCls.ToString() == "Button" && MatchesAny(cleanTxt, opts)) {
                    targetBtn = child;
                }
                return true;
            }, IntPtr.Zero);

            if (targetBtn != IntPtr.Zero) {
                SendMessage(targetBtn, BM_CLICK, IntPtr.Zero, IntPtr.Zero);
                success = true;
                return false;
            }
            return true;
        }, IntPtr.Zero);

        return success;
    }

    public static bool ClickDialogButton(string titleKeyword, string buttonLabels) {
        var opts = buttonLabels.Split('|');
        bool success = false;

        EnumWindows((h, l) => {
            if (!IsWindowVisible(h)) return true;
            var cls = new StringBuilder(64);
            GetClassName(h, cls, 64);
            if (cls.ToString() != "#32770") return true;

            var title = new StringBuilder(256);
            GetWindowText(h, title, 256);
            bool match = title.ToString().IndexOf(titleKeyword, StringComparison.OrdinalIgnoreCase) >= 0;

            IntPtr targetBtn = IntPtr.Zero;
            EnumChildWindows(h, (child, l2) => {
                var btnTxt = new StringBuilder(512);
                GetWindowText(child, btnTxt, 512);
                var btnCls = new StringBuilder(64);
                GetClassName(child, btnCls, 64);

                if (btnTxt.ToString().IndexOf(titleKeyword, StringComparison.OrdinalIgnoreCase) >= 0) {
                    match = true;
                }

                string cleanTxt = btnTxt.ToString().Replace("&", "").Trim();
                if (btnCls.ToString() == "Button" && MatchesAny(cleanTxt, opts)) {
                    targetBtn = child;
                }
                return true;
            }, IntPtr.Zero);

            if (match && targetBtn != IntPtr.Zero) {
                SendMessage(targetBtn, BM_CLICK, IntPtr.Zero, IntPtr.Zero);
                success = true;
                return false;
            }
            return true;
        }, IntPtr.Zero);

        return success;
    }
}
"@

if (-not ([System.Management.Automation.PSTypeName]'Win32').Type) {
    Add-Type -TypeDefinition $win32Code -Language CSharp
}

# ----------------- FUNGSI KONFIGURASI -----------------
function Load-Config {
    if (Test-Path $ConfigPath) {
        try {
            $raw = Get-Content -Path $ConfigPath -Raw | ConvertFrom-Json
            return $raw
        } catch {
            Write-Warning "Gagal membaca $ConfigPath, menggunakan setelan default."
        }
    }
    return [PSCustomObject]@{
        serverIp = "auto"
        serverPort = 3000
        fallbackServerIp = "127.0.0.1"
        pollIntervalSeconds = 1.5
        defaultExamBrowserDir = "C:\ExamBrowserClient"
        searchDirectories = @("C:\ExamBrowserClient", "C:\ExamBrowser", "D:\ExamBrowserClient", "D:\ExamBrowser", "C:\ANBK")
        autoApproveWebcam = $true
    }
}

$Script:Config = Load-Config
$Script:ActiveServerUrl = ""
$Script:ClientId = $env:COMPUTERNAME

# ----------------- FUNGSI AUTO-DISCOVERY SERVER DINAMIS -----------------
function Discover-Server {
    Write-Host "[Discovery] Mencari server proktor dinamis secara otomatis..." -ForegroundColor Cyan

    # 1. Jika ada IP yang didefinisikan secara khusus (selain auto)
    if ($Script:Config.serverIp -ne "auto" -and -not [string]::IsNullOrWhiteSpace($Script:Config.serverIp)) {
        try {
            $testUrl = "http://$($Script:Config.serverIp):$($Script:Config.serverPort)/api/info"
            $res = Invoke-RestMethod -Uri $testUrl -TimeoutSec 1 -ErrorAction SilentlyContinue
            if ($res -and $res.serverIp) {
                return "http://$($Script:Config.serverIp):$($Script:Config.serverPort)"
            }
        } catch {}
    }

    # 2. Coba temukan lewat Hostname Komputer Server (TETAP walaupun IP berubah)
    $serverHostnames = @("WIN-A34NP8S7ADV", "SERVER-PROKTOR", "PROKTOR-PC", "SERVER")
    foreach ($hname in $serverHostnames) {
        try {
            $testUrl = "http://$hname`:$($Script:Config.serverPort)/api/info"
            $res = Invoke-RestMethod -Uri $testUrl -TimeoutSec 1 -ErrorAction SilentlyContinue
            if ($res -and $res.serverIp) {
                Write-Host "[Discovery] Server ditemukan via Nama Komputer ($hname)!" -ForegroundColor Green
                return "http://$hname`:$($Script:Config.serverPort)"
            }
        } catch {}
    }

    # 3. Coba UDP Broadcast & Query Aktif (Port 3001)
    try {
        $udp = New-Object System.Net.Sockets.UdpClient
        $udp.Client.ReceiveTimeout = 1500
        $udp.Client.Bind((New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any, 0)))

        # Kirim sinyal pencarian aktif ke broadcast
        $queryBytes = [System.Text.Encoding]::UTF8.GetBytes("REMOTE_EXAMBRO_FIND_SERVER")
        $udp.Send($queryBytes, $queryBytes.Length, "255.255.255.255", 3001) | Out-Null

        $sender = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any, 0)
        $bytes = $udp.Receive([ref]$sender)
        $message = [System.Text.Encoding]::UTF8.GetString($bytes)
        $udp.Close()

        if ($message -like "REMOTE_EXAMBRO_BEACON:*") {
            $beacon = $message.Substring(22) | ConvertFrom-Json
            Write-Host "[Discovery] Server ditemukan via sinyal UDP di $($beacon.ip):$($beacon.port)" -ForegroundColor Green
            return "http://$($beacon.ip):$($beacon.port)"
        }
    } catch {
        try { if ($udp) { $udp.Close() } } catch {}
    }

    # 4. Coba periksa apakah Default Gateway bertindak sebagai server
    try {
        $gw = (Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Select-Object -First 1).NextHop
        if ($gw -and $gw -ne '0.0.0.0') {
            $testUrl = "http://$gw`:$($Script:Config.serverPort)/api/info"
            $res = Invoke-RestMethod -Uri $testUrl -TimeoutSec 1 -ErrorAction SilentlyContinue
            if ($res -and $res.serverIp) {
                Write-Host "[Discovery] Server ditemukan di Default Gateway ($gw)!" -ForegroundColor Green
                return "http://$gw`:$($Script:Config.serverPort)"
            }
        }
    } catch {}

    # 5. Pemindaian Otomatis Subnet Lokal (Menemukan IP Server Dinamis Apapun)
    $myIP = Get-LocalIP
    if ($myIP -match '^(\d+\.\d+\.\d+)\.\d+$') {
        $subnet = $matches[1]
        Write-Host "[Discovery] Memindai subnet $subnet.* mencari server yang sedang aktif..." -ForegroundColor Cyan
        
        # Prioritas: IP terakhir yang diketahui, lalu seluruh rentang lab
        $priorityHosts = @(85, 100, 1, 2, 200, 50, 10, 254) + (3..99) + (101..199)
        foreach ($h in $priorityHosts) {
            $targetIP = "$subnet.$h"
            $sock = New-Object System.Net.Sockets.TcpClient
            $iar = $sock.BeginConnect($targetIP, $Script:Config.serverPort, $null, $null)
            if ($iar.AsyncWaitHandle.WaitOne(60, $false)) {
                try {
                    $sock.EndConnect($iar)
                    $sock.Close()
                    $testUrl = "http://$targetIP`:$($Script:Config.serverPort)/api/info"
                    $res = Invoke-RestMethod -Uri $testUrl -TimeoutSec 1 -ErrorAction SilentlyContinue
                    if ($res -and $res.serverIp) {
                        Write-Host "[Discovery] Server otomatis ditemukan di $targetIP!" -ForegroundColor Green
                        return "http://$targetIP`:$($Script:Config.serverPort)"
                    }
                } catch {
                    $sock.Close()
                }
            } else {
                $sock.Close()
            }
        }
    }

    $fallback = "http://$($Script:Config.fallbackServerIp):$($Script:Config.serverPort)"
    Write-Host "[Discovery] Menggunakan fallback ke $fallback..." -ForegroundColor Yellow
    return $fallback
}

# ----------------- FUNGSI INFORMASI SISTEM -----------------
function Get-LocalIP {
    $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { 
        $_.InterfaceAlias -notmatch 'Loopback|vEthernet|Virtual' -and $_.IPAddress -notmatch '^169\.254\.' 
    } | Select-Object -First 1).IPAddress
    if (-not $ip) { $ip = "127.0.0.1" }
    return $ip
}

function Get-LocalMAC {
    try {
        $adapter = Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { 
            $_.Status -eq 'Up' -and $_.InterfaceDescription -notmatch 'Virtual|Loopback|Hyper-V|VMware'
        } | Select-Object -First 1
        if ($adapter) { return $adapter.MacAddress }
    } catch {}
    return ""
}

function Get-WebcamInfo {
    try {
        $cam = Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object {
            $_.Status -eq 'OK' -and (
                $_.Class -eq 'Camera' -or
                ($_.Class -eq 'Image' -and $_.FriendlyName -match 'cam|video|webcam')
            )
        } | Select-Object -First 1
        if ($cam) {
            return @{ Available = $true; Name = $cam.FriendlyName }
        }
    } catch {}
    return @{ Available = $false; Name = "Tidak Terdeteksi" }
}

function Find-ExamBrowserExe {
    param([string]$customDir)

    # 0. Periksa SHORTCUT (.lnk) di Desktop (User Desktop & Public Desktop)
    $desktopFolders = @(
        [Environment]::GetFolderPath('Desktop'),
        (Join-Path $env:USERPROFILE 'Desktop'),
        'C:\Users\Public\Desktop'
    ) | Where-Object { $_ -and (Test-Path $_) }

    try {
        $wsh = New-Object -ComObject WScript.Shell
        foreach ($desk in $desktopFolders) {
            $shortcuts = Get-ChildItem -Path $desk -Filter '*.lnk' -ErrorAction SilentlyContinue
            foreach ($lnk in $shortcuts) {
                if ($lnk.Name -match '(?i)exam|anbk|cbt|browser') {
                    $sc = $wsh.CreateShortcut($lnk.FullName)
                    if ($sc.TargetPath -and (Test-Path $sc.TargetPath) -and ($sc.TargetPath -match '(?i)\.exe$')) {
                        Write-Host "[Otomasi] ExamBrowser ditemukan melalui Shortcut Desktop: $($lnk.Name) -> $($sc.TargetPath)" -ForegroundColor Green
                        return $sc.TargetPath
                    }
                }
            }
        }
    } catch {}

    $dirsToCheck = @()
    if ($customDir -and (Test-Path $customDir)) { $dirsToCheck += $customDir }
    if ($Script:Config.defaultExamBrowserDir) { $dirsToCheck += $Script:Config.defaultExamBrowserDir }
    if ($Script:Config.searchDirectories) { $dirsToCheck += $Script:Config.searchDirectories }

    # Tambahkan Documents, Downloads & Desktop pengguna
    $userDocs = [Environment]::GetFolderPath('MyDocuments')
    if ($userDocs -and (Test-Path $userDocs)) { $dirsToCheck += $userDocs }
    $userDocs2 = Join-Path $env:USERPROFILE 'Documents'
    if (Test-Path $userDocs2) { $dirsToCheck += $userDocs2 }

    $userDownloads = Join-Path $env:USERPROFILE 'Downloads'
    if (Test-Path $userDownloads) { $dirsToCheck += $userDownloads }

    $userDesktop = [Environment]::GetFolderPath('Desktop')
    if ($userDesktop) { $dirsToCheck += $userDesktop }
    $dirsToCheck += "C:\Users\Public\Desktop"

    # 1. Periksa folder langsung
    foreach ($d in $dirsToCheck) {
        if ($d -and (Test-Path $d)) {
            $candidate = Join-Path $d "ExamBrowser.exe"
            if (Test-Path $candidate) { return $candidate }
        }
    }

    # 2. Cari di subfolder Desktop / Downloads / ANBK hingga kedalaman 3
    foreach ($d in $dirsToCheck) {
        if ($d -and (Test-Path $d)) {
            $f = Get-ChildItem -Path $d -Filter '*Exam*.exe' -Recurse -Depth 3 -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '(?i)exambrowser|exambro' } | Select-Object -First 1
            if ($f) { return $f.FullName }
        }
    }

    # 3. Cari otomatis di folder utama drive C:\ dan D:\
    $drives = @('C:\', 'D:\')
    foreach ($drv in $drives) {
        if (Test-Path $drv) {
            $f = Get-ChildItem -Path $drv -Filter '*Exam*.exe' -Recurse -Depth 2 -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '(?i)exambrowser|exambro' } | Select-Object -First 1
            if ($f) { return $f.FullName }
        }
    }

    return $null
}

# ----------------- FUNGSI OTOMASI UTAMA -----------------
function Start-ExamBrowserOtomasi {
    param(
        [bool]$WithWebcam = $false,
        [string]$CustomDir = ""
    )

    $exePath = Find-ExamBrowserExe -customDir $CustomDir
    if (-not $exePath) {
        return @{
            Success = $false
            Message = "ExamBrowser.exe tidak ditemukan di folder yang ditentukan."
        }
    }

    $existingProc = Get-Process -Name 'ExamBrowser', 'runningexam' -ErrorAction SilentlyContinue
    if ($existingProc) {
        return @{
            Success = $true
            Message = "ExamBrowser sudah berjalan (PID: $(($existingProc | Select-Object -First 1).Id))."
        }
    }

    $workDir = [System.IO.Path]::GetDirectoryName($exePath)
    Write-Host "[Otomasi] Menjalankan: $exePath dari $workDir" -ForegroundColor Cyan

    try {
        Start-Process -FilePath $exePath -WorkingDirectory $workDir
    } catch {
        return @{
            Success = $false
            Message = "Gagal mengeksekusi ExamBrowser.exe: $($_.Exception.Message)"
        }
    }

    # Loop UIAutomation & Dialog klik
    $AE = [System.Windows.Automation.AutomationElement]
    $popupDone = $false
    $runClicked = $false

    $maxWait = 180 # Maksimal 180 detik
    for ($i = 0; $i -lt $maxWait; $i++) {
        Start-Sleep -Seconds 1

        # 1. Otomatis klik tombol OK jika muncul popup autoupdate
        if (-not $popupDone) {
            $popupDone = [Win32]::ClickDialogButton('autoupdate', 'OK')
            if ($popupDone) {
                Write-Host "[Otomasi] Popup autoupdate terdeteksi dan diklik OK!" -ForegroundColor Green
            }
        }

        # 2. Cari jendela ExamBrowser Client dan tombol RUN
        try {
            $wins = $AE::RootElement.FindAll('Children', [System.Windows.Automation.Condition]::TrueCondition)
            foreach ($w in $wins) {
                if ($w.Current.Name -notmatch '(?i)exambrowser\s+client') { continue }
                
                # Cari tombol RUN
                foreach ($b in $w.FindAll('Descendants', [System.Windows.Automation.Condition]::TrueCondition)) {
                    if ($b.Current.Name -match '^\s*RUN\s*$') {
                        $pattern = $null
                        if ($b.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
                            $pattern.Invoke()
                        } else {
                            $rect = $b.Current.BoundingRectangle
                            $clickX = [int]($rect.X + ($rect.Width / 2))
                            $clickY = [int]($rect.Y + ($rect.Height / 2))
                            [Win32]::ClickAt($clickX, $clickY)
                        }
                        $runClicked = $true
                        Write-Host "[Otomasi] Tombol RUN berhasil diklik via UIAutomation!" -ForegroundColor Green
                        break
                    }
                }

                # Fallback: jika detik ke-10 tombol belum terbaca, klik area bawah tengah jendela
                if (-not $runClicked -and $i -ge 10) {
                    $rect = $w.Current.BoundingRectangle
                    $clickX = [int]($rect.X + ($rect.Width / 2))
                    $clickY = [int]($rect.Y + ($rect.Height * 0.90))
                    [Win32]::ClickAt($clickX, $clickY)
                    $runClicked = $true
                    Write-Host "[Otomasi] Fallback klik koordinat tombol RUN dieksekusi!" -ForegroundColor Yellow
                    break
                }

                if ($runClicked) { break }
            }
        } catch {
            # Abaikan COM / UIA transient exceptions
        }

        if ($runClicked) { break }
    }

    # 3. Tangani dialog konfirmasi setelah klik RUN (Yes/No, Izin Webcam, atau OK)
    Write-Host "[Otomasi] Menunggu dialog konfirmasi setelah RUN (Yes/No / Izin Webcam)..." -ForegroundColor Cyan
    $confirmHandled = $false

    for ($j = 0; $j -lt 30; $j++) {
        Start-Sleep -Seconds 1

        # Cek tombol Yes / Ya via Win32 API
        if ([Win32]::ClickAnyDialogButton('Yes|Ya|&Yes|&Ya')) {
            $confirmHandled = $true
            Write-Host "[Otomasi] Dialog konfirmasi (Yes/Ya) berhasil diklik otomatis!" -ForegroundColor Green
            break
        }

        # Cek tombol OK tambahan jika ada
        if ([Win32]::ClickDialogButton('autoupdate', 'OK')) {
            Write-Host "[Otomasi] Popup dialog OK berhasil diklik!" -ForegroundColor Green
        }

        # Cek tombol Yes / Ya via UIAutomation Element
        try {
            $allWins = $AE::RootElement.FindAll('Children', [System.Windows.Automation.Condition]::TrueCondition)
            foreach ($aw in $allWins) {
                foreach ($ab in $aw.FindAll('Descendants', [System.Windows.Automation.Condition]::TrueCondition)) {
                    if ($ab.Current.Name -match '^\s*(&?Yes|&?Ya)\s*$') {
                        $p = $null
                        if ($ab.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) {
                            $p.Invoke()
                        } else {
                            $r = $ab.Current.BoundingRectangle
                            [Win32]::ClickAt([int]($r.X + $r.Width/2), [int]($r.Y + $r.Height/2))
                        }
                        $confirmHandled = $true
                        Write-Host "[Otomasi] Tombol Yes/Ya berhasil ditekan via UIAutomation!" -ForegroundColor Green
                        break
                    }
                }
                if ($confirmHandled) { break }
            }
        } catch {}

        if ($confirmHandled) { break }
    }

    $msg = "ExamBrowser berhasil dibuka dan tombol RUN diklik."
    if ($confirmHandled) {
        $msg += " (Konfirmasi Yes otomatis disetujui)"
    }

    return @{
        Success = $true
        Message = $msg
    }
}

function Close-ExamBrowserGraceful {
    $proc = Get-Process -Name 'ExamBrowser', 'runningexam' -ErrorAction SilentlyContinue |
            Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1

    if (-not $proc) {
        # Coba cek proses tanpa window handle
        $anyProc = Get-Process -Name 'ExamBrowser', 'runningexam' -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $anyProc) {
            return @{ Success = $true; Message = "ExamBrowser tidak sedang berjalan." }
        }
    }

    try {
        if ($proc -and $proc.MainWindowHandle -ne 0) {
            [Win32]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null # SW_RESTORE
            [Win32]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
            Start-Sleep -Milliseconds 400
        }

        # Kirim kombinasi tombol Ctrl + C + B
        # VK_CONTROL = 0x11, 'C' = 0x43, 'B' = 0x42
        $keys = @([byte]0x11, [byte]0x43, [byte]0x42)

        # Tekan tombol (Key Down)
        foreach ($k in $keys) {
            [Win32]::keybd_event($k, 0, 0, 0)
            Start-Sleep -Milliseconds 80
        }

        Start-Sleep -Milliseconds 400

        # Lepaskan tombol dalam urutan terbalik (Key Up)
        [array]::Reverse($keys)
        foreach ($k in $keys) {
            [Win32]::keybd_event($k, 0, [Win32]::KEYEVENTF_KEYUP, 0)
            Start-Sleep -Milliseconds 40
        }

        return @{
            Success = $true
            Message = "Sinyal tutup aman (Ctrl + C + B) berhasil dikirim ke ExamBrowser."
        }
    } catch {
        return @{
            Success = $false
            Message = "Gagal mengirim kombinasi tombol: $($_.Exception.Message)"
        }
    }
}

function Stop-ExamBrowserForce {
    try {
        $procs = Get-Process -Name 'ExamBrowser', 'runningexam' -ErrorAction SilentlyContinue
        if (-not $procs) {
            return @{ Success = $true; Message = "ExamBrowser tidak sedang berjalan." }
        }
        $count = $procs.Count
        $procs | Stop-Process -Force -ErrorAction SilentlyContinue
        return @{ Success = $true; Message = "Berhasil mematikan paksa $count proses ExamBrowser." }
    } catch {
        return @{ Success = $false; Message = "Gagal mematikan proses: $($_.Exception.Message)" }
    }
}

function Take-ScreenThumbnail {
    try {
        $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $bmp = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height
        $gfx = [System.Drawing.Graphics]::FromImage($bmp)
        $gfx.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
        $gfx.Dispose()

        # Resize ke thumbnail 480x270 untuk transmisi cepat di jaringan lab
        $targetWidth = 480
        $targetHeight = 270
        $thumb = New-Object System.Drawing.Bitmap $targetWidth, $targetHeight
        $thumbGfx = [System.Drawing.Graphics]::FromImage($thumb)
        $thumbGfx.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::Bilinear
        $thumbGfx.DrawImage($bmp, 0, 0, $targetWidth, $targetHeight)
        $thumbGfx.Dispose()
        $bmp.Dispose()

        $ms = New-Object System.IO.MemoryStream
        $thumb.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg)
        $thumb.Dispose()
        $bytes = $ms.ToArray()
        $ms.Dispose()

        $base64 = [Convert]::ToBase64String($bytes)
        return "data:image/jpeg;base64,$base64"
    } catch {
        return $null
    }
}

# ----------------- EKSEKUSI TUGAS DARI SERVER -----------------
function Handle-Task {
    param($task)

    $id = $task.id
    $cmd = $task.command
    $params = $task.params
    Write-Host "[Tugas Diterima] ID: $id | Perintah: $cmd" -ForegroundColor Green

    $result = @{
        taskId = $id
        success = $false
        message = ""
        screenshot = $null
    }

    switch ($cmd) {
        "launch_standard" {
            $customDir = if ($params.customDir) { $params.customDir } else { "" }
            $res = Start-ExamBrowserOtomasi -WithWebcam $false -CustomDir $customDir
            $result.success = $res.Success
            $result.message = $res.Message
        }
        "launch_webcam" {
            $customDir = if ($params.customDir) { $params.customDir } else { "" }
            $res = Start-ExamBrowserOtomasi -WithWebcam $true -CustomDir $customDir
            $result.success = $res.Success
            $result.message = $res.Message
        }
        "close_graceful" {
            $res = Close-ExamBrowserGraceful
            $result.success = $res.Success
            $result.message = $res.Message
        }
        "kill_force" {
            $res = Stop-ExamBrowserForce
            $result.success = $res.Success
            $result.message = $res.Message
        }
        "screenshot" {
            $img = Take-ScreenThumbnail
            if ($img) {
                $result.success = $true
                $result.message = "Screenshot berhasil diambil."
                $result.screenshot = $img
            } else {
                $result.success = $false
                $result.message = "Gagal mengambil screenshot."
            }
        }
        "shutdown" {
            $sec = if ($params.seconds) { [int]$params.seconds } else { 30 }
            $msg = if ($params.message) { $params.message } else { "Komputer akan dimatikan dalam $sec detik oleh Proktor." }
            try {
                & shutdown.exe /s /f /t $sec /c $msg
                $result.success = $true
                $result.message = "Perintah shutdown ($sec detik) berhasil dieksekusi."
            } catch {
                $result.message = "Gagal shutdown: $($_.Exception.Message)"
            }
        }
        "restart" {
            $sec = if ($params.seconds) { [int]$params.seconds } else { 30 }
            $msg = if ($params.message) { $params.message } else { "Komputer akan direstart dalam $sec detik oleh Proktor." }
            try {
                & shutdown.exe /r /f /t $sec /c $msg
                $result.success = $true
                $result.message = "Perintah restart ($sec detik) berhasil dieksekusi."
            } catch {
                $result.message = "Gagal restart: $($_.Exception.Message)"
            }
        }
        "cancel_shutdown" {
            try {
                & shutdown.exe /a
                $result.success = $true
                $result.message = "Proses shutdown/restart berhasil dibatalkan."
            } catch {
                $result.message = "Gagal membatalkan shutdown: $($_.Exception.Message)"
            }
        }
        "exec_custom" {
            $scriptText = $params.script
            if ($scriptText) {
                try {
                    $out = Invoke-Expression $scriptText | Out-String
                    $result.success = $true
                    $result.message = "Skrip kustom dieksekusi: $out"
                } catch {
                    $result.message = "Error skrip: $($_.Exception.Message)"
                }
            } else {
                $result.message = "Skrip kosong."
            }
        }
        default {
            $result.message = "Perintah '$cmd' tidak dikenali."
        }
    }

    return $result
}

# ----------------- LOOP UTAMA (HEARTBEAT & POLLING) -----------------
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "   🚀 RemoteExambro Client Agent Aktif                " -ForegroundColor Yellow
Write-Host "   PC Name : $env:COMPUTERNAME                        " -ForegroundColor White
Write-Host "======================================================" -ForegroundColor Cyan

$serverUrl = Discover-Server
$Script:ActiveServerUrl = $serverUrl

$pendingResults = @()

while ($true) {
    try {
        # Cek status proses ExamBrowser
        $examProc = Get-Process -Name 'ExamBrowser', 'runningexam' -ErrorAction SilentlyContinue | Select-Object -First 1
        $camInfo = Get-WebcamInfo
        $currentUser = (Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue).UserName
        if (-not $currentUser) { $currentUser = $env:USERNAME }

        # Payload Heartbeat
        $heartbeat = @{
            clientId = $Script:ClientId
            hostname = $env:COMPUTERNAME
            ip = Get-LocalIP
            mac = Get-LocalMAC
            username = $currentUser
            exambrowserRunning = ($examProc -ne $null)
            exambrowserPid = if ($examProc) { $examProc.Id } else { $null }
            webcamAvailable = $camInfo.Available
            webcamName = $camInfo.Name
            osVersion = [System.Environment]::OSVersion.VersionString
            uptime = [int]((Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime).TotalMinutes
            results = $pendingResults
        }

        $jsonPayload = $heartbeat | ConvertTo-Json -Depth 5 -Compress

        # Kirim HTTP POST Heartbeat
        $response = Invoke-RestMethod -Uri "$($Script:ActiveServerUrl)/api/agent/heartbeat" `
                                      -Method Post `
                                      -Body $jsonPayload `
                                      -ContentType 'application/json' `
                                      -TimeoutSec 3 `
                                      -ErrorAction Stop

        Write-Host "[Agent] $(Get-Date -Format 'HH:mm:ss') -> Berhasil terhubung ke server ($($Script:ActiveServerUrl)) | Status: ONLINE" -ForegroundColor Green

        # Kosongkan hasil yang sudah terkirim
        $pendingResults = @()

        # Eksekusi tugas dari server jika ada
        if ($response -and $response.tasks -and $response.tasks.Count -gt 0) {
            foreach ($t in $response.tasks) {
                $taskRes = Handle-Task -task $t
                $pendingResults += $taskRes
            }
        }

    } catch {
        # Jika gagal menghubungi server, coba temukan kembali server
        Write-Warning "[Agent] Terputus dari server ($($Script:ActiveServerUrl)): $($_.Exception.Message)"
        Start-Sleep -Seconds 3
        $Script:ActiveServerUrl = Discover-Server
    }

    Start-Sleep -Milliseconds ([int]($Script:Config.pollIntervalSeconds * 1000))
}
