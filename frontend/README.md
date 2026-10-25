# SIGAP Workspace

Frontend React + TypeScript + Vite untuk petugas posko. Workspace kini terintegrasi dengan backend SIGAP via `/api/*` (REST + SSE) dan memiliki fallback otomatis ke mode demo jika backend belum berjalan.

```powershell
cd frontend
npm install
npm run dev
```

Buka http://127.0.0.1:5173. Pemeriksaan: `npm test` dan `npm run build`.

## Tes browser Playwright

Suite yang aktif ada di [`tests/e2e/`](tests/e2e/README.md), dengan file tes eksplisit `workspace.spec.ts` dan `approval.spec.ts`. Jalankan dari folder `frontend`:

```powershell
npm ci
npx playwright install chromium
npm run test:e2e
```

Playwright otomatis menjalankan frontend pada port **5183** dan backend **mock** pada port **8797**, menggunakan SQLite memori. Biarkan kedua port kosong. Konfigurasi ini tidak memakai server operasional, provider LLM, atau database posko nyata. Hasil HTML: `npm run test:e2e:report`; mode interaktif: `npm run test:e2e:ui`.

Suite mencakup desktop dan mobile Chromium, autentikasi sesi otomatis, laporan dan SSE, detail/klarifikasi, pencarian/filter, CSV, unggah dan validasi file, kebutuhan tanpa kalkulasi, serta gerbang persetujuan manusia. Mode mobile adalah emulasi Chromium, bukan pengujian perangkat fisik. Integrasi Langflow/MCP/Bob nyata perlu diuji tersendiri sesuai protokol Outside-In.

Untuk menguji **Gemini + Langflow nyata**, jalankan `npm run test:e2e:live`. Suite ini memakai port 5184/8798 dan database memori, membutuhkan konfigurasi live, serta memblokir writer/publikasi. [Skenario dan hasil pengujian live](tests/live/README.md).

Skrip lama `tests/browser-review.mjs` dan `tests/browser-gemini-status.mjs` disimpan sebagai referensi historis; selector-nya mengikuti UI lama. Gunakan suite `test:e2e` untuk antarmuka saat ini. `SIGAP_BROWSER_EXECUTABLE` opsional untuk memakai executable Chrome/Chromium sendiri.

## Interaksi yang tersedia

Navigasi hanya ada di satu tempat: tab di header (**Laporan**, **Rekap**, **Buletin**) ditambah indikator status koneksi. Tiap halaman satu kolom dan satu fokus: **Laporan** untuk kirim laporan dan melihat pratinjau, **Rekap** untuk memeriksa dan menyetujui, **Buletin** untuk membaca draf. Kotak chat hanya tampil di halaman Laporan. Tautan antarhalaman hanya muncul saat relevan (mis. tombol "Periksa" saat ada posko bermasalah).

Logo memakai artwork `Logo Design.svg`: simbol tangan pada header, artwork lengkap pada splash, serta ikon tab browser. Splash tampil sekitar 1,4 detik saat halaman dibuka (0,6 detik dengan reduced motion); aplikasi menginisialisasi sesi di belakangnya, navigasi belakang dinonaktifkan sementara, dan kegagalan backend tidak membuat splash tertahan. Tes eksplisit: `tests/e2e/startup.spec.ts`. [Paket skenario dan feedback uji pengguna](../data/synthetic/user-validation/README.md) memuat database awal sintetis yang terpisah dari rekap lama.

- Tempel pesan WhatsApp atau unggah `.txt` / `.csv` UTF-8 hingga 200 KiB. CSV menerima koma, titik koma atau tab, kutip dan newline dalam sel, 1–100 baris dan 2–64 kolom. Backend menormalkan sumber, menyaring PII, lalu meneruskan ke LLM dan validator Langflow; unggah tidak otomatis mengirim atau menyimpan.
- Konflik dengan rekap SQLite ditampilkan pada dialog persetujuan dengan nilai lama/baru dan waktu sumber. Semua konflik memerlukan pilihan eksplisit, terikat snapshot/hash persetujuan. Setelah write dan read-back terverifikasi, kebutuhan dihitung ulang dari nilai yang benar-benar disimpan. [Template CSV](../data/synthetic/template-impor-posko.csv) dan [panduan migrasi](../langflow/SQLITE_MIGRATION.md).
- Integrasi live: status koneksi mendeteksi `/api/health`. Jika terhubung, percakapan dan aliran proses dialirkan melalui SSE.
- Masukkan token dari `backend/data/session-token.txt` pada dialog koneksi. SSE menggunakan fetch dengan header Bearer dan `Last-Event-ID` saat reconnect. Token tidak dimasukkan ke URL.
- Rekap dari server menggunakan kandidat kanonis, ID laporan, dan usulan clear aktual. Angka kebutuhan hanya ditampilkan setelah hasil kalkulasi server diterima; data demo tidak dicampur dengan rekap server.
- Cari posko/desa, filter status, buka detail dan sumber laporan.
- Klarifikasi satu posko mempertahankan hasil hitung posko lain selama sumbernya tidak berubah. Setelah kandidat koreksi tervalidasi pada mode live, backend otomatis menghitung ulang snapshot terbaru melalui Langflow. Empat kebutuhan tampil di dialog detail dan rekap tanpa perintah chat tambahan. Bila kalkulator gagal, kandidat tetap tersedia dengan pemberitahuan; hasil lama yang berubah tidak dipakai. Permintaan seperti **"Periksa kebutuhan di semua desa"** menghitung seluruh rekap tersimpan ditambah kandidat terbaru melalui Langflow; permintaan khusus rekap tersimpan mengecualikan kandidat yang belum disimpan.
- Klik **Tulis klarifikasi** di dialog detail untuk mengubah jumlah jiwa, laki-laki, perempuan, lansia, disabilitas, atau menambahkan catatan tanpa berpindah ke chat utama. **Validasi perubahan** mengirim koreksi terikat ke posko/sumber yang dipilih; hasil kandidat baru tampil di dialog yang sama. Koreksi belum menyimpan rekap. Kolom kosong tidak menghapus nilai lama, dan persetujuan simpan tetap terpisah.
- Draf angka/catatan tidak direset oleh pembaruan hasil hitung saja. Pencocokan nama posko memakai kesamaan nama yang dinormalisasi dan desa; nama yang hanya mirip tidak digabungkan. Untuk mengganti nama melalui catatan, tulis eksplisit **“Koreksi nama posko ini menjadi Posko Cibening Utama.”** Validator mengambil nama dari sumber permintaan yang immutable dan mempertahankan target lama untuk keputusan simpan; nama baru dari model tanpa permintaan tersebut tetap ditolak. Regresi UI ada di `tests/e2e/editEdgeCases.spec.ts`, integrasi live ada di `tests/user-validation/edit-responses.spec.ts`.
- Klarifikasi beberapa posko bergantian mempertahankan semua kandidat yang belum disimpan dalam sesi yang sama. **Kandidat untuk disetujui** memilih cakupan persetujuan; tombol simpan di detail otomatis memilih kandidat milik posko tersebut. Pilihan konflik dan konfirmasi tidak dipindahkan antar kandidat walaupun nomor laporannya sama. Setelah satu kandidat terverifikasi, kandidat lain dan hasil perhitungannya tetap tampil. Backend menyampaikan snapshot yang digantikan secara eksplisit; hanya kandidat tersebut yang dihapus dari daftar. Regresi diuji di `tests/pendingReviews.test.ts` dan `tests/e2e/pendingReviews.spec.ts`, termasuk urutan A → B → A dan penyimpanan terpisah. Daftar kandidat frontend masih mengikuti umur sesi halaman; reload membuat sesi baru.
- Tinjau konflik data (mis. 45+55 != 98), kebutuhan air Sphere (15 L/orang/hari) dan draf buletin; salin draf atau unduh CSV.
- Chat dan buletin mendukung Markdown (judul, teks tebal, daftar, tabel). Tabel lebar digeser mendatar di dalam konten, tanpa menyembunyikan kolom terakhir di mobile. Buletin ditampilkan dan disalin tanpa kalimat penutup atribusi lama; label DRAF dan rujukan sumber tetap ditampilkan.
- Persetujuan versi kandidat dengan konfirmasi rekap parsial dan keputusan pengosongan field (clear / keep / defer). Pada mode live, keputusan dicatat di backend SQLite dan diverifikasi sebelum penyimpanan.
- Backend mock menghasilkan pratinjau sintetis serta simulasi write/read-back, dengan label yang jelas dan tanpa klaim penyimpanan nyata.
- Layout desktop dan mobile, dialog native dan informasi status koneksi.

Jalur utama: Web → Backend SIGAP (Fastify) → Gemini API + MCP → Langflow. Provider Bob/ACP dan mock dapat dipilih pada backend. UI membedakan Gemini dikonfigurasi/belum siap dari backend mock; status health bukan bukti end-to-end. Konfigurasi model dan API key disimpan di `.env` root. Token sesi backend disinkronkan otomatis tanpa kontrol token manual.

Tes tambahan `tests/browser-gemini-status.mjs` memeriksa label dan ketiadaan kandidat palsu pada backend Gemini dengan GEMINI_API_KEY kosong. Gunakan konfigurasi Playwright yang sama dengan tes browser mock. Restart backend setelah key/model diubah.

`src/demo.ts` menyimpan fixture, `src/review.ts` validasi demo, `src/App.tsx` interaksi, dan `src/styles.css` tampilan (satu stylesheet, token warna dan skala tipografi di `:root`) dan `src/chatDock.css` panel chat. Reload menghapus riwayat sesi. Font DM Sans dimuat dari Google Fonts dengan fallback Segoe UI.
# Provider percakapan dan token otomatis

Progres Input → Proses → Tinjau → Simpan hanya muncul pada aktivitas laporan/koreksi dan persetujuan perubahan. Membaca rekap, bertanya, menghitung kebutuhan, dan memeriksa kejanggalan memakai status aktivitas di chat. Pengecekan lanjutan menyembunyikan progres perubahan sambil mempertahankan kandidat dan referensi persetujuannya; sesudah penyimpanan selesai, hasil ditampilkan melalui badge verifikasi.

Daftar posko kini menampilkan ringkasan pemeriksaan di bawah status dan tautan ke rincian lengkap. Dialog detail mengelompokkan data belum dilaporkan, hal yang perlu diklarifikasi, keputusan konflik/pengosongan, serta kelengkapan stok. Penjelasan memakai metadata server dan nilai kosong; nol eksplisit tetap dianggap terisi. Masalah stok, data tersimpan dan angka belum terverifikasi ikut memicu status klarifikasi.

Konfigurasi lokal saat ini memakai `oc/deepseek-v4.1-flash-free` melalui endpoint backend yang kompatibel OpenAI. Dialog koneksi menampilkan model dari health backend. Kolom token sesi dan tombol Simpan Token dihapus; bootstrap dan pemulihan autentikasi otomatis tetap melalui API backend. API key model tidak dikirim ke frontend.
