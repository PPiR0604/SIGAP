# Frontend SIGAP

Aplikasi React + TypeScript + Vite untuk petugas, admin dan pembaca publik. Antarmuka menggunakan backend untuk autentikasi, sesi, laporan, OCR, rekap dan persetujuan; kegagalan backend tidak otomatis diganti data demo.

## Menjalankan

```powershell
cd frontend
npm ci
npm run dev
```

Buka `http://127.0.0.1:5173` dengan backend yang sesuai. Untuk Docker, jalankan `docker compose up -d --build` dari root. Lihat [panduan utama](../README.md) untuk prasyarat Supabase dan Langflow.

## Alur penggunaan

- **Tugas:** temukan data yang perlu diperiksa, ditinjau atau dilengkapi.
- **Laporan:** tulis laporan, unggah TXT/CSV/PDF/JPG/PNG, tarik berkas atau tempel gambar ke kotak chat. OCR menghasilkan teks untuk diperiksa dan diedit; unggahan tidak otomatis mengirim laporan atau menyimpan data. TXT/CSV maksimal 200 KiB; PDF/gambar maksimal 5 MiB dan PDF maksimal 5 halaman.
- **Rekap:** lihat posko, filter, buka detail, klarifikasi dan unduh CSV. Draf koreksi perlu validasi dan persetujuan; periksa status baca ulang setelah simpan.
- **Buletin:** susun draf dan tinjau sumber. Admin dapat menyetujui tautan publik; penerima tautan dapat membaca tanpa akun.

Panel total kebutuhan dan status pemeriksaan dapat dibuka terpisah. Kebutuhan hasil hitung tidak sama dengan kebutuhan yang dilaporkan; kekurangan memerlukan data stok yang memadai. Data kosong tidak sama dengan nol. Frontend mengomunikasikan kegagalan pemuatan dan tidak menganggap status health sebagai bukti seluruh workflow berhasil.

## Pengujian

```powershell
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

Tes Playwright menggunakan server dan fixture terisolasi; detail dan batasannya ada di [tests/e2e/README.md](tests/e2e/README.md). Tes live terpisah dan memerlukan konfigurasi serta verifikasi lingkungan sendiri; lihat [tests/live/README.md](tests/live/README.md).
