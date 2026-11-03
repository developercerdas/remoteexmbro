# 🚀 RemoteExambro - Sistem Kendali Jarak Jauh ExamBrowser Client

Aplikasi manajemen, kontrol, dan otomasi massal **ExamBrowser Client (ANBK / SNBT / CBT / TKA)** berbasis Web Dashboard untuk komputer Server Proktor dan Agen Ringan Mandiri (*zero-dependency*) untuk seluruh PC Klien Siswa di laboratorium komputer sekolah.

Sistem ini terinspirasi dari alur otomasi `eriksihabudin/otomasi-exambrowser-action1`, namun dibangun menjadi **solusi mandiri (*self-hosted*)** tanpa ketergantungan pihak ketiga, dilengkapi antarmuka modern real-time, auto-discovery jaringan lokal, dan pemantau layar langsung.

---

## 🌟 Fitur Utama

1. **Otomasi Buka & Auto-RUN:**
   * Membuka `ExamBrowser.exe` secara interaktif di sesi desktop siswa yang sedang aktif.
   * Mendeteksi dan otomatis mengklik tombol **OK** jika muncul popup pembaruan (*autoupdate*).
   * Otomatis mengklik tombol **RUN** via Windows UI Automation & fallback simulasi koordinat.
2. **Dukungan Khusus Ujian Berkamera (Webcam Auto-Approval):**
   * Mendeteksi perangkat kamera terpasang secara otomatis.
   * Menyetujui dialog izin *"merekam aktifitas"* (`Yes` / `Ya`) seketika tanpa perlu disentuh siswa.
3. **Tutup Aman (Graceful Exit):**
   * Mengirim kombinasi tombol standar resmi `Ctrl + C + B` via Win32 API ke jendela ExamBrowser.
   * Mencegah kerusakan sesi atau force-kill yang bisa merusak log lokal siswa.
4. **Emergency Force Kill:**
   * Menutup paksa proses `ExamBrowser.exe` atau `runningexam` jika terjadi error/hang tak terduga.
5. **Pemantau Layar Klien (Live Screenshot):**
   * Mengambil gambar layar siswa secara instan dan mengirim thumbnail ke dashboard proktor untuk memastikan seluruh siswa sudah masuk ke menu login ujian.
6. **Manajemen Daya Massal (Shutdown & Restart):**
   * Mematikan atau merestart seluruh PC lab dengan dialog peringatan hitung mundur (*countdown*).
   * Fitur batalkan shutdown darurat jika salah pencet.
7. **Zero-Dependency Client Agent (Tanpa Perlu Install Node.js di Klien):**
   * Agen klien 100% menggunakan PowerShell native yang sudah bawaan Windows 7/8/10/11.
   * Auto-Discovery via UDP broadcast (port 3001) sehingga IP server terdeteksi secara otomatis tanpa setting manual satu per satu.
8. **Modern Real-Time Dashboard (WebSocket):**
   * Menampilkan grid status PC klien, user yang login, status ExamBrowser, ketersediaan kamera, dan log aktivitas real-time.

---

## 📁 Struktur Folder Proyek

```
D:\APLIKASI\RemoteExambro\
├── START_SERVER.bat            # 1-Klik Jalankan Server Proktor & Buka Dashboard
├── PANDUAN_PROKTOR.md          # Panduan lengkap teknisi / proktor lab
├── README.md                   # Dokumentasi teknis sistem
│
├── server/                     # Master Controller Server (Node.js + WebSocket)
│   ├── server.js               # Core backend server, UDP beacon, dan API
│   ├── package.json            # Dependensi Express & WS
│   └── public/                 # Web Dashboard Proktor
│       ├── index.html          # UI Proktor responsif (Tailwind & Phosphor Icons)
│       ├── app.js              # Logika frontend, WebSocket, dan dispatcher
│       └── style.css           # Styling tambahan
│
└── client-agent/               # Paket Agen Komputer Klien / Siswa
    ├── agent.ps1               # Skrip inti otomasi (Win32 UIAutomation & Polling)
    ├── config.json             # Konfigurasi agen & direktori pencarian ExamBrowser
    ├── SilentRunner.vbs        # Pembantu menjalankan agen tanpa jendela CMD
    ├── PASANG_AGEN.bat         # Installer 1-klik untuk PC klien (Task Scheduler)
    ├── JALANKAN_SEMENTARA.bat  # Mode pengujian tanpa instalasi permanen
    └── HAPUS_AGEN.bat          # Uninstaller bersih agen
```

---

## 🚀 Cara Menjalankan

### 1. Menjalankan Server di PC Proktor:
1. Pastikan Node.js sudah terpasang di komputer server/proktor.
2. Buka folder `D:\APLIKASI\RemoteExambro`.
3. Klik dua kali pada file **`START_SERVER.bat`**.
4. Browser akan otomatis terbuka mengarah ke `http://localhost:3000`. Di bar atas, catat alamat IP LAN server yang muncul (misalnya: `192.168.1.50:3000`).

### 2. Memasang Agen di PC Siswa/Klien Lab:
Pilih salah satu metode berikut:

#### Opsi A: Menggunakan Flashdisk (Paling Cepat untuk Lab Non-Domain)
1. Salin seluruh isi folder `client-agent` ke dalam flashdisk.
2. Tancapkan flashdisk ke PC klien lab yang sudah login ke Windows.
3. Klik kanan pada **`PASANG_AGEN.bat`** -> **Run as administrator**.
4. Agen otomatis terpasang ke `C:\RemoteExambroAgent`, aktif di latar belakang, dan otomatis mencari server di jaringan LAN.

#### Opsi B: Menggunakan Shared Folder (Jaringan LAN)
1. Bagikan folder `client-agent` dari PC server lewat Network Sharing.
2. Di PC klien, buka `\\IP-SERVER\client-agent`, lalu jalankan `PASANG_AGEN.bat`.

---

## ⚙️ Konfigurasi Path ExamBrowser

Secara default, agen akan mencari `ExamBrowser.exe` di:
* `C:\ExamBrowserClient`
* `C:\ExamBrowser`
* `C:\ANBK`
* `D:\ExamBrowserClient`
* `D:\ExamBrowser`

Jika di sekolah Anda file `ExamBrowser.exe` disimpan di folder berbeda, cukup edit file `config.json` di dalam folder `client-agent`:
```json
{
  "serverIp": "auto",
  "defaultExamBrowserDir": "D:\\FolderUjian\\ExamBrowserClient"
}
```

---

## 📜 Lisensi
MIT License - Bebas digunakan dan disesuaikan untuk seluruh sekolah dan instansi pendidikan.
