# Perbaikan UX seluruh halaman — 26 Oktober 2026

Ruang lingkup mengikuti audit halaman login, Laporan, klarifikasi, Rekap, dan Buletin. Ini merupakan pemeriksaan heuristik dan pengujian otomatis; validasi kegunaan dengan peserta tetap diperlukan.

## Perubahan

- Login menyediakan **Lupa kata sandi?**, permintaan tautan secara eksplisit, formulir kata sandi baru dan konfirmasinya, serta petunjuk tautan kedaluwarsa dan batas pengiriman. Kata sandi minimal delapan karakter. Token callback dihapus dari URL sebelum permintaan jaringan, disimpan sementara dalam memori, dan tidak dipakai untuk membuka ruang operasional. Backend memverifikasi kepemilikan token ke Supabase sebelum memperbarui kata sandi. Redirect dikendalikan server; pemulihan tidak memberikan role atau penugasan.
- Laporan berfokus pada input, percakapan dan pratinjau. Tombol **Buka rekap posko** membawa pengguna ke ringkasan dashboard. Diagram kebutuhan dan kelompok rentan tetap dapat dibuka melalui disclosure pada posko terpilih. Diagram global tersedia pada Rekap.
- Form klarifikasi memiliki kolom **Nama posko**, **Desa**, **Kebutuhan yang dilaporkan**, angka terpilah dan catatan. Isian kosong mempertahankan nilai lama. Daftar kebutuhan terisi mengganti kebutuhan posko yang ditargetkan saja. Hasil server dibandingkan dengan perubahan yang diminta; hasil yang belum menerapkannya tidak diklaim berhasil dan draf tetap tersedia. Pergantian nama mengikuti bentuk instruksi eksplisit yang dikenali validator Langflow.
- Rekap membedakan status **Tersimpan** dari kelengkapan dan konflik per posko. Pemilih **Perubahan yang akan disimpan** menjelaskan lingkup persetujuan. Kandidat posko lain dan konfirmasi manusia tetap dipertahankan.
- Buletin memiliki satu aksi salin, susun/susun ulang yang menyesuaikan keberadaan draf, dan cetak yang terkunci saat kosong atau sibuk. Teks placeholder tidak dapat disalin atau dicetak melalui aksi aplikasi. Referensi versi berada di detail yang dapat dibuka, sedangkan isi tetap menampilkan status draf dan sumber. Tidak ada publikasi otomatis.
- Pesan gagal berada dekat tindakan dan tidak menghilang setelah lima detik. Input yang belum terkirim dipertahankan. Berkas bukan UTF-8 memiliki petunjuk perbaikan berbahasa Indonesia. Fokus judul mengikuti perpindahan halaman; disclosure dapat digunakan dengan keyboard.

## File tes eksplisit

| File | Cakupan |
| --- | --- |
| `e2e/passwordRecovery.spec.ts` | Permintaan eksplisit, callback dan pembersihan URL, konfirmasi kata sandi, token kedaluwarsa, tanpa akses operasional otomatis. |
| `e2e/wholePageUx.spec.ts` | Pesan gagal bertahan lebih dari lima detik, input tetap ada, fokus navigasi, akses diagram, koreksi teks yang diabaikan, buletin kosong. |
| `e2e/bulletinActions.spec.ts` | Satu aksi salin, isi clipboard, kunci saat sibuk, cetak, referensi sumber dan keyboard. |
| `e2e/villageCorrection.spec.ts` | Nama, desa dan kebutuhan berubah pada target yang sama; posko lain bernama sama tetap utuh; tidak menyimpan otomatis. |
| `e2e/charts.spec.ts` | Diagram tetap tersedia setelah perpindahan halaman, filter dan pembaruan data. |
| `e2e/workspace.spec.ts` | Pesan unggah gagal melalui alert yang menetap, UTF-8 dan input lama. |
| `../../backend/tests/supabaseAuth.test.ts` | Redirect pemulihan, respons generik akun tidak dikenal, token divalidasi upstream sebelum PUT, pembatasan peran/scope, tanpa pemberian akses saat reset. |

## Menjalankan pemeriksaan

```powershell
cd frontend
npm test
npx playwright test --max-failures=5
npm run build
cd ../backend
node --import tsx --test tests/supabaseAuth.test.ts
npm run build
```

Browser memakai backend uji dengan database in-memory dan SSE terkontrol pada port 5183/8797, dua viewport (desktop Chromium dan Pixel 7). Pemulihan menggunakan provider tiruan: tidak ada email pemulihan sungguhan yang dikirim atau kata sandi pengguna nyata yang diubah. Cetak diuji melalui pemanggilan fungsi, bukan printer fisik. Pengujian ini tidak menjamin respons semantik model live untuk setiap ragam bahasa.

Alur pemulihan mengikuti [panduan password Supabase](https://supabase.com/docs/guides/auth/passwords) dan [referensi resetPasswordForEmail](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail). Pengiriman email nyata bergantung pada konfigurasi SMTP, kuota, dan redirect allowlist Supabase yang digunakan proyek.

## Hasil akhir

- **166/166** tes Playwright desktop/mobile lulus dalam 4,5 menit, tanpa retry.
- **38/38** unit frontend dan **23/23** tes autentikasi backend lulus.
- Pemeriksaan TypeScript backend dan build produksi frontend lulus. Build Docker backend/frontend berhasil dan kedua layanan sudah dipasang ulang tanpa menghapus volume.
- Frontend HTTP 200, backend `ready` dalam mode `live` dan container backend `healthy`. Aset yang disajikan `/assets/index-CjRwyImN.js` memuat UI pemulihan terbaru.
- `tests/smoke/ux-readonly.mjs` berhasil membuka login → pemulihan → kembali masuk pada Docker di viewport ponsel: tanpa overflow horizontal, error JavaScript, maupun request mutasi. Screenshot lokal: `test-results/live-ux/pemulihan-mobile.png`.
- Route pemulihan yang terpasang menolak body kosong dengan 422 sebelum menghubungi provider.

Build masih memberi peringatan ukuran chunk JavaScript di atas 500 kB; ini bukan kegagalan build. Pengiriman email nyata dan perilaku model live tetap berada di luar cakupan pemeriksaan otomatis ini.
