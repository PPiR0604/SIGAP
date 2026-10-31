# OCR dokumen laporan

OCR dipasang sebagai prapemrosesan input di backend, tanpa tool MCP atau pemanggilan LLM tambahan. Langflow tetap menjalankan ekstraksi informasi terstruktur, validasi, kalkulasi kebutuhan dan penyimpanan dengan persetujuan manusia. Tidak perlu mengimpor ulang flow Langflow untuk fitur ini.

```text
PDF / JPG / PNG
    → backend: pemeriksaan akses, format, ukuran dan jumlah halaman
    → OCR lokal Tesseract (Indonesia + Inggris), PDF dirender oleh Poppler
    → pengguna meninjau dan mengoreksi teks
    → Gunakan teks / Tambahkan ke laporan
    → Kirim secara eksplisit
    → filter PII dan workflow Agent ↔ MCP ↔ Langflow yang sudah ada
    → pratinjau dan persetujuan penyimpanan
```

## Cara memakai

Di tab **Laporan**, pilih **Unggah berkas** lalu PDF, PNG, JPG atau JPEG. Setelah OCR selesai, periksa teks pada panel **Tinjau hasil OCR**, terutama jumlah jiwa, angka terpilah, nama desa dan tabel. Teks bisa diedit sebelum digunakan. Jika draf sudah terisi, aksi utama menambahkan OCR di akhir draf. **Batalkan OCR** mempertahankan draf semula; pembacaan yang masih berjalan juga dapat dibatalkan.

Hasil OCR belum otomatis dikirim ke Agent. Pengguna masih perlu memilih **Gunakan teks ini** atau **Tambahkan ke laporan**, kemudian **Kirim**. CSV aktif tidak digabung diam-diam dengan teks OCR: kirim atau bersihkan CSV terlebih dahulu. Setelah dipakai, hasil memiliki nama sumber `nama-asli.ext.ocr.txt` agar alur teks backend tetap kompatibel.

## Kontrak dan batas

`POST /api/sessions/:id/documents/extract` memakai Bearer yang sama dengan endpoint sesi, body `application/octet-stream`, dan header `X-Document-Name` berisi nama yang di-encode dengan `encodeURIComponent`. Tidak menerima URL sumber. Respons `Cache-Control: no-store` memuat `text`, `filename`, `pages`, `engine`, `source_sha256`, serta `warnings`.

- Maksimal **5 MiB**, **5 halaman PDF**, dan teks keluaran **200 KiB**. Tidak mengembalikan potongan halaman pertama saja jika batas halaman terlampaui.
- JPG/PNG diperiksa signature dan dimensinya: maksimal 24 megapiksel dan 8000 piksel per sisi. PDF dirender per halaman dengan sisi terpanjang 2400 piksel.
- Total proses maksimal **75 detik**, dua pekerjaan bersamaan per backend, satu pekerjaan per sesi, dan 12 permintaan per akun per menit. Batas ini berlaku per proses backend pada instalasi lokal ini.
- Viewer, pending, akun di luar penugasan, dan pengguna lain yang menebak ID sesi ditolak sebelum engine dijalankan.
- Berkas menggunakan nama sementara tetap di direktori privat acak, dihapus dalam `finally` saat proses selesai atau gagal. Berkas asli dan teks hasil OCR tidak ditulis ke database aplikasi, tidak dimasukkan ke log, dan tidak dikirim ke penyedia OCR eksternal. Setelah pengguna memilih Kirim, teks mengikuti alur data laporan normal dan penyaringan PII yang sudah ada.
- Pemanggilan native menggunakan argumen proses langsung, tanpa shell, dan memakai batas waktu serta keluaran. Nama berkas pengguna tidak menjadi path atau argumen perintah engine.

OCR tidak membuktikan data benar. Foto miring, buram, tulisan tangan, kolom rapat, dan tabel kompleks dapat terbaca keliru. Gunakan dokumen tegak dan jelas, lalu cocokkan hasil dengan dokumen asli. Dokumen Word, PDF terkunci, TIFF dan HEIC belum didukung.

## Menjalankan

Docker backend memasang `tesseract-ocr`, bahasa `ind`/`eng`, dan `poppler-utils`. Tidak memerlukan API key OCR. Nginx frontend menerima body hingga 5 MiB; rute laporan teks tetap memakai batas awalnya.

```powershell
docker compose build backend frontend
docker compose up -d --no-build backend frontend
```

Jika backend dijalankan langsung di Windows, sediakan executable `tesseract`, `pdfinfo`, dan `pdftoppm` pada PATH beserta data bahasa `ind`/`eng`; alternatif yang diuji proyek adalah menjalankan backend dengan Docker. Tidak adanya runtime menghasilkan pesan layanan belum tersedia, bukan hasil OCR palsu.

Referensi implementasi: [Tesseract CLI dan pilihan bahasa](https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html), [paket OCR Alpine](https://pkgs.alpinelinux.org/package/v3.23/community/x86_64/tesseract-ocr), dan [Poppler utilities Alpine](https://pkgs.alpinelinux.org/package/v3.23/main/x86_64/poppler-utils).

## Pengujian

- `backend/tests/documentOcr.test.ts`: format palsu, ukuran/dimensi, batas halaman, PDF terkunci, urutan halaman, teks kosong/terlalu panjang, runtime tidak ada, pembatalan, sanitasi error dan penghapusan berkas.
- `backend/tests/supabaseAuth.test.ts`: hak akses dan kepemilikan sesi OCR, tanpa batch/write otomatis, concurrency, batas request dan rate limit lintas sesi.
- `frontend/tests/e2e/documentOcr.spec.ts`: tinjau/edit sebelum Kirim, mempertahankan draf yang diketik saat menunggu, append/cancel, pembatalan pembacaan, hasil terlambat, batas unggahan, error kosong dan perlindungan CSV. HTTP OCR dimock untuk tes UI yang deterministik.
- `backend/scripts/ocr-smoke.ts`: OCR **nyata** PNG/JPG/PDF dua halaman dengan nama posko dan angka yang diharapkan; gambar kosong dan PDF enam halaman harus ditolak. Dijalankan di image Docker tanpa jaringan.
- `backend/scripts/ocr-http-smoke.ts`: route biner → OCR **nyata** → pesan teks menggunakan repositori in-memory dan fake agent. Memastikan tidak ada batch sebelum pengiriman eksplisit. Tidak memakai akun atau database operasional.
- Sampel sintetis berada di `data/synthetic/ocr/`, dengan generator Pillow `generate.py`. Tidak ada data pribadi nyata.

## Hasil verifikasi 27 Oktober 2026

- Suite frontend penuh: **184/184** tes browser desktop/mobile lulus tanpa retry (3,9 menit), ditambah **38/38** unit frontend.
- Setelah penyempurnaan agar koreksi teks OCR bertahan saat pindah tab, **16/16** tes OCR/CSV desktop/mobile diuji ulang dan lulus.
- Backend: **30/30** tes OCR dan autentikasi lulus. Pemeriksaan TypeScript backend dan build frontend juga lulus.
- Engine OCR nyata lulus membaca nama dan angka yang diharapkan dari PNG, JPG dan PDF dua halaman. Gambar putih kosong serta PDF enam halaman ditolak dengan alasan yang sesuai. Uji engine berjalan tanpa jaringan.
- Route biner dengan OCR nyata menerima PDF dua halaman di repositori in-memory; tidak ada batch sebelum pengiriman teks eksplisit ke pipeline.
- `frontend/tests/smoke/ocr-live.mjs` menguji **UI hasil build Docker → endpoint unggahan sandbox → OCR nyata PNG/PDF → tinjauan editable → append**. Seluruh request API diarahkan ke container sandbox `ocr-sandbox.ts`, tanpa API produksi, akun pengguna, atau database operasional. Tidak ada pesan Agent dikirim. Container sandbox dihentikan setelah pengujian.
- Image backend/frontend telah dipasang. Frontend HTTP 200 memuat `/assets/index-BySLovlN.js`; backend produksi `ready`, mode `live`, container `healthy`. Tidak ada reset volume atau impor ulang flow.

Pengujian memakai contoh sintetis yang jelas dan tegak. Belum merupakan pengukuran akurasi OCR pada foto lapangan atau tulisan tangan pengguna. Uji sandbox tidak membuktikan respons semantik LLM live terhadap setiap dokumen.
