# Petunjuk login dan pendaftaran — 25 Oktober 2026

Halaman masuk, daftar, dan kirim ulang verifikasi menggunakan petunjuk sesuai konteks. Kolom memiliki label dan bantuan yang terhubung melalui `aria-describedby`; validasi tampil setelah kolom ditinggalkan atau percobaan submit. Persyaratan kata sandi tetap minimal 8 karakter, dengan tombol tampilkan/sembunyikan yang tidak mengirim form.

Panduan menjelaskan perbedaan pendaftaran, verifikasi email, dan aktivasi/penugasan admin. FAQ dapat dibuka dengan keyboard. Respons pendaftaran tetap mengikuti pesan backend dan tidak dianggap sebagai bukti email terkirim. Setelah login berhasil, petunjuk email digantikan status akses akun yang sebenarnya.

Verifikasi:

- `npm run build`: lulus.
- `npm test`: 38/38 lulus. Tes SSE memerlukan akses loopback; percobaan dalam sandbox diblokir, kemudian berhasil dengan akses lokal yang disetujui.
- `npx playwright test authGuidance.spec.ts verificationReturn.spec.ts passwordPolicy.spec.ts frontendRefresh.spec.ts --max-failures=3`: 32/32 lulus, desktop dan mobile.
- Setelah menambahkan skenario transisi login akun pending, `npx playwright test authGuidance.spec.ts --max-failures=2`: 8/8 lulus, desktop dan mobile.
- Tangkapan layar pendaftaran desktop dan lebar 375 px diperiksa; tidak ada pelebaran viewport.
- Container frontend dibangun ulang; halaman dan bundle pada port 5173 memuat petunjuk, tombol kata sandi, validasi, serta langkah lanjutan baru.

Pengujian memakai server terisolasi dan respons Auth tiruan. Tidak membuat akun nyata atau mengirim email verifikasi. Endpoint dan aturan akses backend tidak diubah oleh pekerjaan ini.
