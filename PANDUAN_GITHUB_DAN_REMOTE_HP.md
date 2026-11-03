# 📱 Panduan: Upload ke GitHub & Kontrol Jarak Jauh via Android / Website

Panduan ini menjelaskan cara mengunggah proyek **RemoteExambro** ke GitHub serta cara mengoperasikan seluruh fiturnya (membuka ExamBrowser, memantau layar, mematikan, hingga **menghidupkan komputer**) langsung dari layar **HP Android** atau website dari mana saja.

---

## 🐙 Bagian 1: Cara Upload Proyek ke GitHub

Kami sudah menyertakan file bantuan otomatis **`UPLOAD_KE_GITHUB.bat`** di dalam folder `D:\APLIKASI\RemoteExambro`.

### Langkah-langkah:
1. Buka browser dan login ke akun GitHub Anda di [https://github.com](https://github.com).
2. Klik tombol **New Repository** (atau buka [https://github.com/new](https://github.com/new)).
3. Beri nama repository, misalnya: `RemoteExambro`.
4. Pilih **Public** atau **Private** (sesuai kebutuhan Anda), lalu biarkan opsi lainnya kosong (jangan centang *Add a README file* karena file README sudah kita buat).
5. Klik **Create repository**.
6. Salin URL repository Anda, contoh:
   ```
   https://github.com/username-anda/RemoteExambro.git
   ```
7. Buka folder `D:\APLIKASI\RemoteExambro` di komputer Anda, lalu **klik ganda pada file `UPLOAD_KE_GITHUB.bat`**.
8. Tempelkan (*paste*) URL repository Anda, lalu tekan **Enter**.
9. Skrip akan secara otomatis:
   * Menginisialisasi git repository.
   * Mengabaikan file `node_modules` (melalui `.gitignore` agar ringan dan cepat).
   * Melakukan commit seluruh kode program.
   * Mengunggah (*push*) ke GitHub.

> **💡 Catatan Login GitHub:**
> Jika muncul jendela login atau diminta password di terminal, gunakan **Personal Access Token (PAT)** GitHub sebagai pengganti password. Token dapat dibuat di menu: *GitHub Settings $\rightarrow$ Developer Settings $\rightarrow$ Personal Access Tokens*.

---

## 📱 Bagian 2: Cara Mengontrol Sistem lewat HP Android

Antarmuka Web Dashboard RemoteExambro sudah didesain **100% responsif**, sehingga sangat nyaman digunakan melalui layar smartphone Android.

### 📶 Opsi A: Melalui Jaringan WiFi Lab yang Sama (Paling Praktis)
Jika HP Android Anda terhubung ke jaringan WiFi yang sama dengan komputer server/proktor:

1. Di komputer proktor, jalankan **`START_SERVER.bat`**.
2. Lihat alamat IP yang tertera di bar atas dashboard, misalnya:
   ```
   Server LAN: 192.168.100.45:3000
   ```
3. Buka browser **Google Chrome** di HP Android Anda.
4. Masukkan alamat tersebut di address bar HP:
   ```
   http://192.168.100.45:3000
   ```
5. Dashboard proktor akan langsung muncul di HP Anda!

#### 🌟 Trik: Jadikan Seperti Aplikasi Native di Layar Depan HP
1. Di Google Chrome Android, buka alamat dashboard tersebut.
2. Klik ikon **titik tiga (⋮)** di kanan atas browser Chrome.
3. Pilih **"Tambahkan ke Layar Utama"** (*Add to Home Screen*) $\rightarrow$ beri nama `Remote ExamBro` $\rightarrow$ klik **Tambah**.
4. Ikon RemoteExambro akan muncul di homescreen HP Anda seperti aplikasi Android sungguhan!

---

### 🌐 Opsi B: Akses dari Mana Saja via Internet (Cloudflare Tunnel - Gratis & Tanpa Setting Router)
Jika Anda ingin mengontrol lab dari luar sekolah, dari rumah, atau menggunakan paket data seluler:

Koneksi internet sekolah biasanya menggunakan IP Private/NAT sehingga tidak bisa port-forwarding biasa. Solusi terbaik, termudah, dan paling aman adalah menggunakan **Cloudflare Tunnel (gratis)**.

1. Unduh file `cloudflared-windows-amd64.exe` dari rilis resmi Cloudflare di [GitHub Cloudflare Tunnel](https://github.com/cloudflare/cloudflared/releases).
2. Simpan file tersebut di folder server dan ubah namanya menjadi `cloudflared.exe`.
3. Jalankan perintah berikut di Command Prompt atau PowerShell:
   ```cmd
   cloudflared tunnel --url http://localhost:3000
   ```
4. Cloudflare akan secara instan menghasilkan link website publik HTTPS aman, misalnya:
   ```
   https://random-nama-lab.trycloudflare.com
   ```
5. Buka link tersebut di HP Android Anda dari mana saja (tanpa perlu terhubung ke WiFi sekolah).

---

## ⚡ Bagian 3: Cara Menghidupkan & Mematikan PC Klien

### 1. Menghidupkan Komputer yang Sedang Mati (Wake-on-LAN)
Fitur **Wake-on-LAN (WoL)** memungkinkan server proktor mengirim paket sinyal khusus (*Magic Packet*) ke kartu jaringan LAN komputer klien untuk menyalakannya dari keadaan mati total (Shutdown).

#### Syarat di PC Klien (Dilakukan Sekali Saja):
1. **Aktifkan di BIOS/UEFI Motherboard PC Klien:**
   * Nyalakan PC dan tekan tombol `DEL` atau `F2` untuk masuk ke BIOS.
   * Cari menu **Power Management** / **ACPI** / **APM Configuration**.
   * Aktifkan opsi: **Wake on LAN (WoL)**, **Power On by PCIE**, atau **Resume By LAN**.
   * Simpan setelan (F10) dan masuk ke Windows.
2. **Aktifkan di Windows Device Manager Klien:**
   * Buka **Device Manager** $\rightarrow$ buka bagian **Network Adapters**.
   * Klik kanan pada adapter LAN (misal: Realtek / Intel PCIe GbE) $\rightarrow$ pilih **Properties**.
   * Buka tab **Power Management** $\rightarrow$ centang:
     - *"Allow this device to wake the computer"*
     - *"Only allow a magic packet to wake the computer"*.
   * Buka tab **Advanced** $\rightarrow$ pastikan opsi **Wake on Magic Packet** bernilai **Enabled**.

#### Cara Eksekusi dari Android / Dashboard:
* **Menyalakan Semua PC Lab:** Klik tombol menu **"Lainnya"** $\rightarrow$ pilih **"Hidupkan PC (Wake-on-LAN)"**.
* **Menyalakan PC Tertentu:** Pada kartu komputer klien yang berstatus Offline, klik tombol kuning **"⚡ Hidupkan"**. Server akan memancarkan sinyal ke alamat MAC kartu jaringan PC tersebut untuk menyalakannya!

---

### 2. Mematikan PC Klien (Shutdown Massal)
1. Dari dashboard di HP Android atau web proktor, klik menu **"Lainnya"** $\rightarrow$ pilih **"Shutdown PC Lab..."**.
2. Anda dapat menentukan:
   * **Hitung Mundur (Countdown):** Misal `30` detik (memberi waktu bagi siswa untuk berkemas).
   * **Pesan Peringatan:** Pesan dialog resmi yang akan muncul di layar monitor peserta.
3. Klik tombol **"Shutdown Sekarang"**.
4. Seluruh komputer peserta akan otomatis mati secara serempak.

> **🚨 Tombol Pembatalan Darurat:**
> Jika Anda salah pencet atau ada siswa yang belum selesai, segera klik tombol menu **"Lainnya"** $\rightarrow$ pilih **"Batalkan Shutdown"**. Perintah shutdown yang sedang menghitung mundur di semua komputer akan seketika dibatalkan!

---

### 3. Menjalankan & Menghentikan ExamBrowser dari HP Android
Sambil berkeliling di dalam ruang laboratorium komputer, proktor cukup menggenggam HP:
* Klik **"Buka & Auto-RUN"** $\rightarrow$ Semua PC siswa otomatis membuka `ExamBrowser.exe`, mengonfirmasi dialog update jika ada, dan menekan tombol **RUN**.
* Klik **"Buka + Izin Webcam"** $\rightarrow$ Untuk ujian ANBK berkamera, dialog persetujuan merekam webcam disetujui otomatis.
* Klik **"Screenshot Layar"** $\rightarrow$ Lihat thumbnail live di HP untuk memastikan siswa sudah di halaman tes.
* Klik **"Tutup Aman (Ctrl+C+B)"** $\rightarrow$ Menutup sesi ujian secara resmi tanpa merusak data ujian.
