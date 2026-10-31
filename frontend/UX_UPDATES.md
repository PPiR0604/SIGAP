# Perbaikan alur kerja dan akses

## Laporan dan OCR

- Berkas dapat dijatuhkan pada kotak laporan atau dipilih lewat tombol unggah. Unggahan tidak mengirim pesan secara otomatis. Beberapa berkas sekaligus ditolak tanpa menghapus draf.
- OCR menampilkan dokumen asli bersama teks yang bisa diperbaiki. PDF menyediakan pemilih halaman; teks tetap mencakup seluruh halaman. Jika browser tidak mendukung pratinjau PDF, pengguna dapat mengunduh dokumen asli.
- Berkas asli dan teks OCR hanya berada di memori halaman. URL blob dicabut saat pratinjau dilepas. Navigasi tab mempertahankan koreksi; pembatalan tidak menghapus draf laporan.
- Status dokumen dibedakan menjadi membaca, perlu diperiksa, dan siap digunakan. Pengguna tetap menekan Kirim untuk menjalankan Agent.
- Pratinjau kosong tidak menampilkan versi kandidat atau tombol persetujuan yang tidak bisa digunakan.
- Pilihan panel diagram disimpan per akun dan pos komando. Penyimpanan browser hanya memuat preferensi buka/tutup, bukan data laporan atau dokumen.
- Dialog persetujuan membandingkan identitas posko, lokasi, jumlah jiwa dan kelompok rentan, serta kebutuhan dengan rekap tersimpan. Pencocokan memakai target/lineage server; nilai lama tidak ditebak jika target ambigu atau belum tersedia. Pilihan konflik dan persetujuan manusia tetap wajib.

## Peran dan pengelolaan

- Admin membuka **Kelola ruang kerja** dari bilah pos komando. Halaman tersedia meskipun operasi pertama belum dibuat.
- Admin dapat meninjau permintaan bergabung, mengubah peran/status/penugasan anggota, membuat atau mengubah operasi, membuat/mencabut undangan, mengubah nama organisasi, dan membaca aktivitas terbaru.
- Setiap mutasi admin memiliki langkah tinjau dan konfirmasi. Kegagalan mempertahankan formulir. Backend tetap menentukan kewenangan, cakupan organisasi, larangan mengubah akun sendiri dan perlindungan admin terakhir.
- Undangan tidak dikirim lewat email otomatis. Token ditampilkan sekali agar admin membagikannya sendiri; token tidak disimpan di browser.
- Membuka pengelolaan tidak membuang draf laporan yang sedang dikerjakan.
- Akun pending dapat meminta akses atau menerima token undangan; akun tidak memilih perannya sendiri.
- Admin meninjau isi buletin sebelum menyetujui publikasi. Persetujuan mengikat batch asal dan hash isi yang diperiksa kembali dengan server. Menyalin, mencetak, atau membuat draf tidak menerbitkan publikasi.
- Viewer membaca isi Markdown publikasi yang sudah disetujui dan dapat memuat ulang daftar. Kontrol operasional tidak ditampilkan.

Semua layar menggunakan API yang sudah tersedia. Tidak ada perubahan schema, akun, penugasan, publikasi, atau isi laporan produksi yang dilakukan untuk pengujian ini.

## Pengujian eksplisit

- `tests/e2e/accessManagement.spec.ts`: admin, viewer, permintaan bergabung, konfirmasi peran, kegagalan penyimpanan, draf saat navigasi, dan persetujuan publikasi yang terikat isi/batch.
- `tests/e2e/uploadDrop.spec.ts`: drop berkas, penolakan multi-file, pratinjau kosong, dan preferensi diagram lintas tab.
- `tests/e2e/documentOcr.spec.ts`: dokumen asli, pemilih halaman PDF, koreksi lintas tab, batas berkas, pembatalan dan pemisahan dari pengiriman Agent.
- `tests/e2e/villageCorrection.spec.ts`: ringkasan identitas/lokasi/kebutuhan dan pemeliharaan posko lain.
- `tests/changeSummary.test.ts`: angka nol dibanding data yang belum diketahui, perubahan nama/lokasi/kebutuhan dan imutabilitas data tersimpan.

Tes browser menggunakan server lokal terpisah dan respons autentikasi/admin sintetis. Pengujian tidak menulis ke Supabase produksi.
