# Tes browser SIGAP

Dijalankan dari `frontend` menggunakan `npm run test:e2e`. Setup pertama: `npm ci` dan `npx playwright install chromium`. Node.js 22 diperlukan oleh backend SQLite. Tidak perlu menyalakan server secara manual. Runner akan menolak port 5183/8797 yang sudah dipakai supaya tidak menjalankan tes terhadap server lain.

## File tes eksplisit

- `workspace.spec.ts`: bootstrap token dan navigasi; kandidat laporan; detail dan klarifikasi; pencarian nama/desa dan filter; isi CSV terfilter; label kebutuhan belum diketahui; unggah TXT tanpa kirim otomatis; penolakan ekstensi salah, kosong, spasi, lebih dari 200 KiB, dan UTF-8 rusak; Ctrl+Enter; ciut/buka chat; viewport dan dialog.
- `approval.spec.ts`: setiap gerbang persetujuan manusia sebelum request keputusan; label simulasi; SSE yang mendahului HTTP; input dan kandidat tetap ada setelah 409; penguncian kirim selama commit.
- `clarification.spec.ts`: klarifikasi langsung dari dialog tanpa pindah halaman; draf chat utama tetap ada; input negatif/pecahan/kosong ditolak; isian dipertahankan setelah 409; SSE mendahului HTTP; kandidat yang tidak menerapkan angka koreksi ditandai agar tidak dianggap berhasil.
- `markdown.spec.ts`: tabel chat enam kolom tanpa status terpotong/tersembunyi; scroll horizontal lokal; buletin dengan judul, daftar, teks tebal, dan tabel; penutup atribusi hilang dari tampilan dan clipboard. Konten SSE terkontrol mengisolasi renderer UI dari variasi model.
- `fixtures.ts`: konteks browser baru per tes, pemantauan uncaught JavaScript errors, dan helper kandidat dari backend mock asli.
- `start-backend.ts`: konfigurasi mock eksplisit dengan SQLite `:memory:` dan token khusus tes. Tidak menjalankan aksi eksternal.
- `vite.config.ts`: proxy khusus backend tes, terpisah dari konfigurasi operasional.
- `../../playwright.config.ts`: dua proyek, Chromium desktop dan emulasi Pixel 7; tanpa retry; server otomatis dihentikan setelah suite selesai.

## Menjalankan dan memeriksa hasil

```powershell
npm run test:e2e
npm run test:e2e -- --project=desktop-chromium
npm run test:e2e -- tests/e2e/approval.spec.ts
npm run test:e2e:ui
npm run test:e2e:report
```

Laporan HTML ada di `frontend/playwright-report/index.html`; ringkasan JSON di `frontend/test-results/results.json`. Trace, screenshot gagal, dan video disimpan saat gagal. Screenshot rekap serta CSV dari tes yang berhasil ada di subfolder `test-results`. Artefak hasil diabaikan Git karena dibuat ulang setiap run.

Semua tes memakai UI React, REST, SSE, dan backend Fastify mock. Hanya skenario balapan HTTP/409 dan commit yang menahan atau mengganti respons secara sengaja. Panggilan font eksternal diblokir agar suite tidak bergantung pada internet. Tidak memakai `waitForTimeout` atau jeda tetap.

## Hasil verifikasi 21 Oktober 2026

- `npm run test:e2e`: **32 passed**, 0 skipped, 0 flaky (16 skenario × 2 viewport; 22,7 detik).
- `npm test`: **18 passed**.
- `npm run build`: **berhasil**.
- Plugin Playwright: smoke test kirim laporan → 2 kandidat rekap → persetujuan tanpa checkbox ditolak: **PASS**, tanpa error console pada navigasi verifikasi terakhir.

Hasil ini memverifikasi perilaku UI dan integrasi backend mock; belum membuktikan eksekusi Langflow/MCP/Bob/Gemini, perhitungan Sphere live, atau penyimpanan eksternal. Mobile memakai emulasi Chromium. Tes viewport memeriksa overflow dokumen dan interaksi dasar, bukan audit aksesibilitas menyeluruh.

Pengujian ulang dengan Langflow aktif dicatat terpisah di [`../live/README.md`](../live/README.md): regresi mock 32/32 kembali lolos, serta skenario live Gemini → MCP → Langflow berhasil menghasilkan kandidat dan kalkulasi Sphere nyata. Jalankan `npm run test:e2e:live` untuk suite tersebut.

## Perbaikan panel persetujuan — 21 Oktober 2026

Masalah panel persetujuan yang menutupi baris terakhir berhasil direproduksi melalui tes regresi pada desktop 1280×720: panel mulai di y=623,2 sementara baris terakhir berakhir di y=718,1. Penyebabnya adalah `.review-actions` memakai `position: sticky; bottom: 16px`.

Panel sekarang mengikuti alur dokumen setelah tabel pada semua ukuran layar. Tes `panel persetujuan tidak menutupi baris terakhir saat halaman digulir` memeriksa batas geometris panel/baris di desktop dan mobile, masing-masing pada tinggi 600/720/900 dan beberapa posisi scroll, lalu membuka detail posko terakhir. Tes ini gagal sebelum perbaikan dan lolos setelahnya.

Verifikasi terakhir: **34/34 tes browser lolos**, tanpa retry atau skip (20,3 detik), dan `npm run build` frontend berhasil. Screenshot desktop yang diperbarui ada di `test-results/workspace-navigasi-dan-dia-980a2-pada-ukuran-viewport-proyek-desktop-chromium/rekap.png`.

## Klarifikasi langsung di dialog — 21 Oktober 2026

Dialog detail kini memiliki editor angka dan catatan opsional. Angka lama tetap tampil selama validasi. Hanya kandidat server yang mengubah tampilan rekap; jika angka yang diminta tidak diterapkan validator, isian koreksi tetap ada dan pesan kesalahan tampil di dialog. Input kosong tidak menghapus data lama dan hasil koreksi tidak menjalankan persetujuan penyimpanan.

Setelah perubahan ini: **44/44 tes browser lolos** (26,2 detik), **18/18 unit test lolos**, dan build frontend berhasil. `clarification.spec.ts` menambah lima skenario di masing-masing proyek desktop dan mobile.

## Tabel chat dan pembacaan buletin — 21 Oktober 2026

Aturan tabel rekap kini dibatasi ke `.recap-table`, termasuk lebar kolom aksi 56px dan penyembunyian kolom aksi di mobile. Tabel Markdown memakai lebar kolom alami dan scroll horizontal lokal, sehingga label status tidak terpecah menjadi kolom tinggi atau hilang pada mobile. `MarkdownContent` dipakai bersama oleh chat dan buletin, dengan dukungan judul, daftar, teks tebal, dan tabel; HTML mentah tetap diabaikan dan URL berbahaya ditolak.

Kalimat penutup atribusi lama dihapus dari pembacaan dan salinan buletin. Payload/hash kanonis server tetap utuh. Komponen Python dan ekspor `langflow/flows/draft_bulletin.json` juga diperbarui agar draf baru tidak menyertakan penutup itu setelah flow diimpor ulang. Untuk flow lama yang masih aktif, frontend tetap membersihkan penutup tersebut. Pratinjau MCP nyata dikonfirmasi melalui `backend/scripts/bulletin-preview-probe.ts` tanpa pembuatan dokumen.

Hasil akhir: **48/48 tes browser lolos** (24,2 detik), **21/21 unit test lolos**, build frontend dan backend berhasil, serta sumber Python dan kode tertanam ekspor flow lolos pemeriksaan sintaks. Screenshot tersedia sebagai `chat-markdown-table.png` dan `buletin-markdown.png` di subfolder masing-masing tes pada `test-results`. Pengujian clipboard menormalkan CRLF Windows saat membandingkan isi.

## Cakupan beberapa desa setelah klarifikasi — 21 Oktober 2026

Perbaikan mempertahankan kalkulasi berdasarkan sidik sumber yang sama (jumlah, data terpilah, stok/periode, kebutuhan dan validasi). Hanya posko yang datanya berubah kehilangan kalkulasi lama sampai ada hasil baru. Pembacaan tersimpan yang datang belakangan digabungkan dengan kandidat, dan respons HTTP terlambat tidak mengosongkan rekap yang sudah tiba lewat SSE. Bootstrap dibatalkan saat cleanup React StrictMode sehingga tidak membuat sesi/aliran chat ganda.

`clarification.spec.ts` memeriksa dua desa: sesudah mengoreksi angka Desa A, kebutuhan beras dan air **300 L/hari** Desa B tetap ada. Desa A menunggu hitungan ulang. Tes berjalan di desktop dan mobile. Backend menguji gabungan data tersimpan dengan koreksi belum disimpan, pemilihan cakupan khusus tersimpan, serta penolakan kandidat yang menghilangkan posko lain.

Verifikasi: **50/50 tes browser lolos** (34,1 detik), **23/23 unit test frontend**, **130/130 tes backend**, dan kedua build berhasil. Uji web live Gemini/MCP/Langflow lolos, termasuk pertanyaan kebutuhan semua desa yang mencakup **10 posko**. Tidak ada penulisan data operasional atau publikasi dokumen.

## Hitung ulang otomatis setelah koreksi — 21 Oktober 2026

`clarification.spec.ts` kini juga memeriksa koreksi populasi Desa A dari 10 ke 12 jiwa: hasil baru **180 L/hari** tampil di dialog yang sama dan tabel kebutuhan, sementara Desa B tetap **300 L/hari** beserta kebutuhan berasnya. Tes dasar tanpa hasil kalkulator tetap memeriksa bahwa angka lama yang berubah tidak dipertahankan. Mode mock hanya menguji pratinjau sintetis; hasil otomatis diuji melalui SSE terkontrol dan suite live nyata.

`backend/tests/correctionRecalculation.test.ts` memeriksa pemanggilan kalkulator otomatis terhadap ID/hash snapshot terbaru, sebelum permintaan persetujuan, untuk kandidat belum disimpan maupun koreksi rekap tersimpan. Referensi lama, cakupan yang menghilangkan desa, kalkulator offline, dan kandidat invalid ditolak tanpa menerbitkan hitungan yang salah. Koreksi valid tetap tersedia bila kalkulator gagal.

Verifikasi: **52/52 tes browser** (26,7 detik), **135/135 tes backend**, **23/23 unit test frontend**, dan build frontend/backend lolos. Uji web Gemini/Langflow nyata **1/1 lolos** (30,6 detik), menghitung otomatis 12 jiwa menjadi air 180 L/hari, pangan 25.200 kkal/hari, jamban 1 unit, hunian 42 m² tanpa pesan hitung tambahan. Semua tetap pratinjau; writer/publikasi diblokir.
# Indikator pemeriksaan data

`villageCorrection.spec.ts` memeriksa klarifikasi desa kosong menjadi desa baru, perubahan ID laporan, dan posko lain bernama sama. Hasil di dialog dicocokkan melalui `update_target`/`candidate_lineage` server sehingga pergantian desa tidak memunculkan kegagalan palsu. Posko lain tetap utuh dan tes tidak mengirim keputusan penyimpanan.

`activityProgress.spec.ts` memeriksa bahwa stepper tersembunyi saat belum ada laporan dan saat membaca/menghitung/memeriksa rekap, tetap muncul untuk laporan dan hitung ulang koreksi, serta tidak menghilangkan kandidat atau pasangan batch/snapshot untuk persetujuan. Penyimpanan selesai merangkum hasil dengan badge; laporan berikutnya memulai progres baru. Dua skenario viewport (desktop/mobile), 28 unit frontend dan build lulus.

`reviewIndicators.spec.ts` memeriksa rekap tersimpan dengan tiga posko parsial, akses rincian dari tabel, data desa/KK/anak/disabilitas yang kosong, stok berperiode 48 jam, masalah jenis stok dan nilai nol eksplisit. Skenario berjalan pada desktop dan mobile. Unit `reviewIndicators.test.ts` juga memeriksa bahwa koreksi menghapus alasan konflik yang sudah selesai dan mempertahankan alasan posko lain. Verifikasi perubahan ini: 28 unit frontend, 62 tes browser dan build lulus.

