# 📋 Panduan Praktis Proktor: Otomasi Remote ExamBrowser

Panduan langkah demi langkah bagi Proktor dan Teknisi Laboratorium Komputer untuk mengontrol puluhan komputer peserta ujian dari satu layar proktor.

---

## 🎯 Tahap 1: Persiapan di Komputer Proktor / Server

1. Buka folder:
   ```
   D:\APLIKASI\RemoteExambro
   ```
2. Jalankan file **`START_SERVER.bat`**.
3. Jendela dashboard proktor akan otomatis terbuka di browser dengan alamat:
   ```
   http://localhost:3000
   ```
4. Perhatikan bagian kanan atas dashboard: Anda akan melihat tulisan **Server LAN: `192.168.x.x:3000`**. Ini adalah alamat IP server di jaringan lokal lab Anda.

---

## 💻 Tahap 2: Pemasangan Agen di PC Siswa / Klien

Anda hanya perlu memasang agen ini **sekali saja** di masing-masing PC klien.

### Metode Flashdisk (1-Klik):
1. Masukkan flashdisk ke PC Proktor, lalu copy folder:
   `D:\APLIKASI\RemoteExambro\client-agent` ke flashdisk.
2. Tancapkan flashdisk ke PC Klien lab.
3. Buka isi folder, klik ganda atau klik kanan **`PASANG_AGEN.bat`** $\rightarrow$ pilih **Run as administrator**.
4. Muncul jendela hitam selama 3 detik, lalu tertutup sendiri.
5. **Cek Dashboard Proktor:** Komputer tersebut akan langsung muncul di daftar klien dengan status lampu hijau **Online**!

> **💡 Catatan DeepFreeze / Shadow Defender:**
> Jika PC lab menggunakan DeepFreeze, pastikan Thaw mode terlebih dahulu sebelum menjalankan `PASANG_AGEN.bat`, kemudian Freeze kembali agar agen tersimpan permanen.

---

## 🚀 Tahap 3: Pelaksanaan Ujian (Hari-H)

### 1. Membuka ExamBrowser di Semua PC Klien Sekaligus
* **Ujian Standar (Tanpa Kamera):**
  Klik tombol biru **"Buka & Auto-RUN"** di bagian atas dashboard.
  * Sistem akan membuka ExamBrowser di semua komputer siswa.
  * Jika muncul dialog konfirmasi auto-update, tombol OK akan diklik otomatis.
  * Tombol **RUN** akan ditekan secara otomatis tanpa siswa perlu menyentuh mouse/keyboard.
* **Ujian Berkamera / SNBT / TKA:**
  Klik tombol ungu **"Buka + Izin Webcam"**.
  * Selain menjalankan tombol RUN, sistem akan otomatis menyetujui prompt izin *"merekam aktifitas"* (Yes/Ya) yang biasanya memerlukan izin peserta.

### 2. Memantau Layar Peserta (Live Thumbnail)
* Ingin memastikan apakah semua siswa sudah berada di halaman login ujian yang benar?
* Klik tombol **"Screenshot Layar"**. Dalam beberapa detik, thumbnail tangkapan layar seluruh komputer klien akan diperbarui di dashboard proktor.
* Klik salah satu gambar untuk memperbesar tangkapan layar monitor siswa tersebut.

### 3. Mengontrol PC Siswa Tertentu
* Jika ada 1 atau 2 PC yang hang atau bermasalah:
  * Anda bisa mencentang kotak di samping nama PC tersebut saja.
  * Gunakan tombol aksi di kartu masing-masing PC (Buka, Tutup, atau Force Kill).

---

## 🛑 Tahap 4: Penutupan Ujian

### 1. Menutup ExamBrowser Secara Aman (Graceful Exit)
* Saat sesi waktu ujian berakhir, klik tombol oranye **"Tutup Aman (Ctrl+C+B)"**.
* Sistem akan memfokuskan jendela ExamBrowser dan mengirim kombinasi tombol resmi `Ctrl + C + B`.
* Sesi ujian akan ditutup secara normal dan bersih tanpa risiko file sesi korup.

### 2. Mematikan PC Lab Sekaligus (Shutdown Massal)
* Klik menu **"Lainnya"** di dashboard $\rightarrow$ pilih **"Shutdown PC Lab..."**.
* Tentukan jeda hitung mundur (misal 30 detik) dan pesan peringatan yang ingin ditampilkan di monitor siswa.
* Klik **"Shutdown Sekarang"**. Seluruh komputer peserta akan mati secara otomatis setelah hitung mundur selesai.
* *Jika salah tekan:* Segera klik menu **"Lainnya"** $\rightarrow$ **"Batalkan Shutdown"**.

---

## ❓ Solusi Masalah Umum (Troubleshooting)

1. **PC Klien tidak muncul di Dashboard?**
   * Pastikan kabel LAN / Wi-Fi PC klien terhubung ke jaringan lokal yang sama dengan server proktor.
   * Pastikan Windows Firewall di PC server mengizinkan port `3000` (TCP) dan `3001` (UDP).
   * Anda bisa menguji agen secara langsung dengan menjalankan `JALANKAN_SEMENTARA.bat` di klien untuk melihat pesan log koneksi.
2. **Pesan: "ExamBrowser.exe tidak ditemukan"?**
   * Buka file `config.json` di dalam folder agen klien, dan pastikan path direktori tempat Anda meletakkan folder ExamBrowser sudah tercantum pada bagian `searchDirectories`.
3. **Tombol RUN tidak terklik otomatis?**
   * Agen memiliki toleransi tunggu hingga 180 detik dan otomatis melakukan fallback klik simulasi koordinat di detik ke-10 jika UIAutomation Windows terlambat merespons.
