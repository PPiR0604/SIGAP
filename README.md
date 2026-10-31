# SIGAP — Sistem Intelijen Logistik dan Asisten Posko

SIGAP membantu petugas membaca laporan posko, memeriksa ketidaksesuaian, menghitung acuan kebutuhan dasar dan menyusun buletin. Hasil OCR dan ekstraksi AI harus diperiksa; perubahan tersimpan setelah persetujuan petugas dan verifikasi baca ulang.

## Arsitektur saat ini

```text
Petugas → Web React → Backend Fastify → model percakapan/ekstraksi
                          │
                          ├─ MCP → Langflow: validasi, perhitungan, rekap dan buletin
                          └─ Supabase Auth + gateway → database Supabase
```

Model tidak mendapat izin menyimpan secara mandiri. Backend membatasi akses, mengikat persetujuan ke kandidat dan memeriksa hasil penyimpanan. Flow Supabase menggunakan capability terbatas dari backend; kredensial tidak dikirim ke model. Provider OpenAI-compatible dan Gemini didukung. Adapter Bob tersedia, tetapi jalur Bob dengan autentikasi Supabase masih fail-closed; jangan mengklaim integrasi Bob end-to-end tanpa pengujian terpisah.

## Fitur

- **Tugas:** pekerjaan pemeriksaan dan klarifikasi posko.
- **Laporan:** chat, unggahan TXT/CSV, OCR dokumen PDF/JPG/PNG dan tempel gambar di kotak chat. Hasil OCR harus ditinjau sebelum dikirim. TXT/CSV maksimal 200 KiB; PDF/gambar maksimal 5 MiB dan PDF maksimal 5 halaman.
- **Rekap:** daftar, pencarian, filter, detail per posko, konflik, koreksi, keputusan persetujuan dan ekspor CSV. Kosong berarti belum diketahui; nol adalah nilai yang dilaporkan.
- **Kebutuhan:** acuan air, energi pangan, jamban dan ruang hunian dihitung di Langflow. Kekurangan hanya tersedia bila stok dan metadata memenuhi syarat. Alokasi kelompok usia merupakan acuan populasi, bukan kebutuhan gizi spesifik individu; lihat [batas perhitungan](langflow/SPHERE_PLANNING.md).
- **Buletin:** draf berbasis sumber yang ditinjau; admin dapat menyetujui dan membagikan tautan publik. Pembaca tautan publik tidak memerlukan akun.

## Menjalankan proyek

Prasyarat: Docker Compose; proyek Supabase yang dikonfigurasi untuk SIGAP; Langflow dengan flow Supabase; dan akses model sesuai provider. Node.js 22 diperlukan untuk pengembangan tanpa Docker.

1. Salin `.env.example` menjadi `.env` di root, lalu isi konfigurasi Supabase, gateway, organisasi, model dan MCP. Jangan commit `.env` atau kredensial.
2. Siapkan schema, organisasi, HMAC gateway dan akun administrator sesuai [panduan Supabase](backend/AUTH_SUPABASE.md) dan [komando](backend/COMMAND_WORKSPACES.md). Jangan menjalankan file bootstrap tes terhadap database produksi.
3. Impor tujuh flow dari [`langflow/flows/supabase/`](langflow/flows/supabase/) ke Langflow, aktifkan MCP, dan atur `SIGAP_BACKEND_INTERNAL_URL` pada proses Langflow agar dapat menghubungi backend. Lihat [panduan Langflow](langflow/README.md).
4. Atur `LANGFLOW_MCP_URL`, `LANGFLOW_API_KEY` dan provider model di `.env`. Untuk registrasi tanpa tautan verifikasi, nonaktifkan **Confirm email** pada Supabase Auth; pengaturan tersebut adalah pilihan deployment dan memiliki konsekuensi pada verifikasi kepemilikan email.
5. Jalankan `docker compose up -d --build`. Buka `http://localhost:5173`; backend berada pada port 8787. Backend container menggunakan `host.docker.internal` untuk layanan lokal host yang relevan.

Konfigurasi production memerlukan Supabase. Mode mock dan SQLite memori terutama untuk fixture/test; bukan fallback diam-diam bagi koneksi produksi. Status health menunjukkan kesiapan konfigurasi, bukan bukti seluruh alur berhasil.

## Pengujian

```powershell
cd backend
npm ci
npm run build
npm test
cd ../frontend
npm ci
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

Tes browser default memakai server dan fixture terisolasi; baca [panduan tes](frontend/tests/e2e/README.md). Uji Langflow Playground → MCP → runtime → alur end-to-end secara terpisah pada lingkungan uji; hasil tes mock tidak membuktikan integrasi live.

## Dokumentasi dan keamanan

- [Backend](backend/README.md) · [Frontend](frontend/README.md) · [Langflow](langflow/README.md)
- [Panduan autentikasi dan deployment](backend/AUTH_SUPABASE.md) · [Ruang operasi](backend/COMMAND_WORKSPACES.md)
- [Data sintetis untuk uji pengguna](data/synthetic/user-validation/README.md) · [sampel OCR](data/synthetic/ocr/README.md)

Simpan password database, secret gateway, API key, backup, token dan data pengguna di luar repo. `.gitignore` tidak menghapus rahasia yang sudah pernah di-commit. Gunakan data sintetis untuk demo publik dan periksa riwayat Git sebelum publikasi.
