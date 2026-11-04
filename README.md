# 🚀 RemoteLab Pro - Sistem Manajemen Lab Terpadu & Pusat Kontrol CBT/Ujian

Aplikasi manajemen, kontrol kelas, pemantauan, dan otomasi massal laboratorium komputer sekolah berbasis Web Dashboard untuk komputer Server Guru/Proktor dan Agen Ringan Mandiri (*zero-dependency*) untuk seluruh PC Klien Siswa di lab.

Aplikasi ini menggabungkan **Manajemen Lab Harian (KBM & Praktikum)**, **Keamanan Lab & Alat Teknisi (Kunci Wallpaper, Blokir Install, Pemeliharaan)**, serta **Mode Ujian Khusus (ExamBrowser ANBK, SNBT, CBT, & TKA)** dalam satu antarmuka terpadu.

---

## 🌟 3 Modul Utama Sistem

### 1. 🖥️ Manajemen Lab (KBM & Harian)
* **Pemantauan Layar & Kamera Real-Time:** Memantau aktivitas layar dan kamera seluruh siswa secara visual.
* **Kunci Layar (Mode Perhatian Siswa):** Menghitamkan dan mengunci layar monitor siswa saat guru sedang menjelaskan materi di depan kelas.
* **Kirim Pesan / Pengumuman:** Mengirimkan notifikasi pesan instan ke layar seluruh komputer siswa.
* **Buka Tautan / Web Bersama:** Membuka alamat website atau portal pembelajaran serentak di browser seluruh siswa.
* **Pemetaan Denah Meja Lab:** Menata urutan PC di dashboard sesuai nomor meja fisik (Meja 01 s/d 36) dengan fitur uji kedip layar (*Flash & Audio Beep*).

### 2. 📝 Mode Ujian (ExamBrowser ANBK & CBT)
* **Otomasi Buka & Auto-RUN:** Membuka `ExamBrowser.exe` secara interaktif dan otomatis mengklik tombol **RUN** serta konfirmasi update.
* **Dukungan Ujian Berkamera (Webcam Auto-Approval):** Menyetujui dialog izin merekam aktivitas kamera secara otomatis.
* **Tutup Aman (Graceful Exit):** Mengirim kombinasi tombol resmi `Ctrl + C + B` untuk menutup ExamBrowser tanpa merusak data sesi ujian.
* **Emergency Force Kill:** Menutup paksa proses jika terjadi error/hang tak terduga.

### 3. 🛡️ Keamanan & Pemeliharaan Teknisi
* **Kunci Wallpaper Desktop:** Mengunci background desktop agar siswa tidak bisa mengganti wallpaper sembarangan.
* **Blokir Instalasi Software Baru:** Memblokir eksekusi installer `.msi` dan file setup sehingga siswa tidak bisa menginstal game atau software liar.
* **Mode Teknisi (1-Klik Buka Kunci):** Teknisi dapat membuka izin instalasi dan wallpaper kapan saja dari server untuk keperluan maintenance.
* **Wake-on-LAN (WoL):** Menyalakan seluruh PC lab secara serentak dari server.
* **Shutdown & Restart Terjadwal:** Mematikan atau merestart seluruh komputer lab dengan peringatan hitung mundur.
* **Pembaruan Agen Otomatis OTA (*Over-The-Air*):** Memperbarui skrip agen di seluruh PC klien serentak lewat jaringan tanpa perlu menggunakan flashdisk.

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
