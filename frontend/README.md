# Frontend SIGAP

Aplikasi React + TypeScript + Vite untuk petugas, admin dan pembaca publik. UI memakai komponen sumber BoardUI; lihat [BOARDUI.md](BOARDUI.md). Antarmuka menggunakan backend untuk autentikasi, sesi, laporan, OCR, rekap dan persetujuan; kegagalan backend tidak otomatis diganti data demo.

## Menjalankan

```powershell
cd frontend
npm ci
npm run dev
```

Buka `http://127.0.0.1:5173`; Vite mem-proxy `/api` ke backend native pada port 8787. Untuk demo Docker lokal, gunakan [installer lokal](../deployment/local/README.md) dan buka port 8080. Perintah `docker compose up -d --build` tanpa file lokal memakai konfigurasi cloud. Lihat [panduan utama](../README.md) untuk prasyarat Supabase dan Langflow.

## Alur penggunaan

- **Tugas:** temukan data yang perlu diperiksa, ditinjau atau dilengkapi.
- **Laporan:** tulis laporan, unggah TXT/CSV/PDF/JPG/PNG, tarik berkas atau tempel gambar ke kotak chat. OCR menghasilkan teks untuk diperiksa dan diedit; unggahan tidak otomatis mengirim laporan atau menyimpan data. TXT/CSV maksimal 200 KiB; PDF/gambar maksimal 5 MiB dan PDF maksimal 5 halaman.
- **Rekap:** lihat posko, filter, buka detail, klarifikasi dan unduh CSV. Draf koreksi perlu validasi dan persetujuan; periksa status baca ulang setelah simpan.
- **Buletin:** susun draf dan tinjau sumber. Admin dapat menyetujui tautan publik; penerima tautan dapat membaca tanpa akun.
- Klarifikasi dan Sphere: buka detail posko untuk memeriksa sumber, mengoreksi isian, serta melihat kebutuhan dan dasar hitungnya. Validasi belum menyimpan perubahan.
- Konflik: bandingkan nilai tersimpan dan kandidat; pemilihan nilai dilanjutkan ke persetujuan yang terikat snapshot.

Pesan teks biasa dipahami model sebelum memilih tool. Pertanyaan analisis tidak dipaksa menjadi laporan oleh daftar kata tanya. Analisis seluruh kebutuhan, peringkat air, dan prioritas umum memakai tool baca-saja backend yang mengomposisi flow Langflow. Angka serta urutan hasilnya berasal dari kalkulator yang diperiksa server.

Panel total kebutuhan dan status pemeriksaan dapat dibuka terpisah. Kebutuhan hasil hitung tidak sama dengan kebutuhan yang dilaporkan; kekurangan memerlukan data stok yang memadai. Data kosong tidak sama dengan nol. Frontend mengomunikasikan kegagalan pemuatan dan tidak menganggap status health sebagai bukti seluruh workflow berhasil.

## Pengujian

```powershell
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

Tes Playwright menggunakan server dan fixture terisolasi; detail dan batasannya ada di [tests/e2e/README.md](tests/e2e/README.md). Tes live terpisah dan memerlukan konfigurasi serta verifikasi lingkungan sendiri; lihat [tests/live/README.md](tests/live/README.md).
## Antrean laporan offline

Saat online, buka SIGAP terlebih dahulu dan tunggu penyiapan antarmuka selesai di **Catatan offline**. Pada origin yang sama, halaman ini dapat dibuka ulang tanpa koneksi setelah service worker aktif. Cache hanya berisi antarmuka dan aset statis; respons API dan publikasi tidak disimpan di cache.

Draf berada di IndexedDB pada profil browser dan perangkat yang sama. Draf teks biasa dapat dibaca oleh pengguna profil tersebut. Koreksi salinan posko membawa akun, pos komando, identitas baris, dan nilai dasar sumber untuk diperiksa ketika dikirim. Jangan masukkan data pribadi yang tidak diperlukan. Penyaringan pola data pribadi oleh backend baru terjadi setelah laporan dikirim. Penghapusan data browser dapat menghapus antrean. Berkas dan OCR belum didukung secara offline.

Pengguna dapat membuat laporan melalui formulir angka, kebutuhan, stok, dan catatan, atau menyimpan teks laporan. Untuk mengoreksi data yang sudah ada, pilih Simpan rekap untuk offline saat masih online, lalu buka salinan posko di halaman offline. Model AI dan login server baru tetap memerlukan koneksi; halaman offline bukan pengganti autentikasi server.

Saat koneksi kembali, masuk dan pilih pos komando yang benar. Di halaman Laporan, buka **Antrean laporan di perangkat**, pilih **Siapkan untuk diproses**, periksa teks, lalu kirim. Salinan antrean tidak dihapus otomatis; hapus secara manual setelah tidak diperlukan. Pengiriman tidak dicoba ulang secara otomatis. Identitas pengiriman disimpan sebelum request pertama dan digunakan lagi pada retry di sesi asal. Jika akun, pos komando, sesi, atau isi laporan berubah, pengiriman diblokir untuk pemeriksaan; jangan menyalin laporan ke antrean baru sebagai jalan pintas karena itu dianggap laporan baru. Pemulihan ke sesi lain belum otomatis.

Halaman **Konflik** menampilkan perbandingan nilai tersimpan dan kandidat. Petugas harus memilih semua nilai sebelum melanjutkan ke modal persetujuan yang terikat snapshot kandidat. Pemilihan nilai saja tidak menyimpan data.

Uji build offline: `npm run build` lalu `npx playwright test --config playwright.offline.config.ts`. Pengujian ini memakai data sintetis dan tidak menghubungi model atau menulis ke rekap operasional.
