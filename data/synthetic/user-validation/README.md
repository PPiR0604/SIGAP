# Paket uji pengguna SIGAP

Semua nama posko dan angka dalam paket ini **sintetis untuk simulasi**, bukan laporan bencana nyata. Paket ini menyiapkan pengujian; belum menjadi bukti feedback pengguna sampai peserta benar-benar mencoba dan memberikan tanggapan.

Mulai dari [PANDUAN-PESERTA.md](PANDUAN-PESERTA.md). Berikan panduan dan berkas input kepada peserta. Simpan `expected-results.json` untuk fasilitator agar peserta tidak diberi jawaban terlebih dahulu.

**Paket tambahan dengan nomor telepon dummy:** gunakan [sesi-manual/PANDUAN-PESERTA.md](sesi-manual/PANDUAN-PESERTA.md) untuk delapan tugas berurutan dengan input siap salin, CSV konflik, pemeriksaan penyamaran nomor, serta acuan fasilitator dan lembar observasi. Pilih paket lama atau paket tambahan untuk satu sesi; jangan menjalankan keduanya berurutan pada baseline yang sama.

| Berkas | Kegunaan |
| --- | --- |
| `baseline.json` | Seed 8 posko / 630 jiwa; referensi administratif, bukan berkas unggahan peserta |
| `expected-results.json` | Nilai pembanding fasilitator; air 9.450 L/hari dan pangan 1.323.000 kkal/hari pada baseline |
| `01-laporan-awal-whatsapp.txt` | Laporan awal lengkap untuk mencoba ekstraksi di lingkungan kosong; jangan dikirim sebagai langkah pertama pada database yang sudah di-seed |
| `02-koreksi-bergantian.txt` | Koreksi Harapan Sukamaju → Cibening → Harapan; cek kandidat lain tidak hilang |
| `03-impor-posko-baru.csv` | Tambah Anggrek (50 jiwa) dan Kenanga (64 jiwa); hasil baseline + CSV = 10 posko / 744 jiwa bila skenario lain belum mengubah total |
| `04-impor-konflik.csv` | Pembaruan berbeda dari data tersimpan; wajib memilih nilai lama atau baru sebelum menyimpan |
| `05-laporan-bermasalah.txt` | Total 70 berbeda dari 35 + 40; semestinya memunculkan klarifikasi, bukan diam-diam dianggap benar |
| `06-perintah-cek.txt` | Contoh baca rekap, hitung semua desa, cek gap dan susun buletin |
| `template-feedback.csv` | Catatan peserta U01–U03; belum diisi dengan hasil pengujian |

Baseline mencakup nilai nol yang sah (stok Pelita dan disabilitas beberapa posko), nilai belum diketahui (Melati), estimasi, stok 48 jam (Nusa), dua posko di Desa Cibineng, serta dua posko bernama Harapan di desa berbeda. Identitas tidak bergantung pada nama desa saja. Semua kelompok rentan dapat beririsan; jangan menjumlahkannya sebagai orang unik.

Baseline memakai waktu 00.00 WIB pada tanggal skenario sehingga koreksi peserta pada hari yang sama tidak lebih lama dari seed. CSV konflik menyasar Teduh dan Harapan Cipandan, yang tidak diubah pada tugas koreksi bergantian. Jika Anda mengulang tugas/berkas setelah posko yang sama sudah diperbarui, laporan lama bisa ditolak dengan benar; mulai dari baseline baru untuk sesi peserta berikutnya.

Jika mengikuti urutan panduan dan selalu memilih angka baru: sesudah tugas 3 total menjadi 638 jiwa (8 posko), sesudah tugas 4 menjadi 752 jiwa (10 posko), dan sesudah kedua perubahan pada tugas 5 menjadi 760 jiwa. Bila tugas 5 mempertahankan semua nilai lama, total tetap 752. Hasil bergantung pada keputusan peserta; catat pilihannya dan jangan menilai keputusan `keep` sebagai kegagalan aplikasi.

## Menjalankan sesi baru

Lakukan sesi peserta **bergiliran** karena penyimpanan rekap dipakai bersama. Awali tiap peserta dengan baseline baru agar hasil sebelumnya tidak mengubah tugas peserta berikutnya. Refresh halaman hanya membuat sesi percakapan baru, bukan mereset database. Selesaikan/catat kandidat yang belum disimpan sebelum refresh. Jangan pakai NIK, nomor telepon, nama korban, atau data pribadi nyata saat tes.

Dari root repository, pilih direktori baru per peserta/sesi. Perintah pertama membuat paket + pratinjau seed tanpa mengubah SQLite. `--apply` mengisi database baru dan mencadangkan sumber lama dengan SQLite backup API, termasuk WAL. Tujuan yang sudah ada ditolak.

```powershell
python langflow/scripts/prepare_user_testing.py --date 2026-10-25 --database output/user-testing/U02/rekap_posko.sqlite3 --backup-from output/rekap_posko.sqlite3
python langflow/scripts/prepare_user_testing.py --date 2026-10-25 --database output/user-testing/U02/rekap_posko.sqlite3 --backup-from output/rekap_posko.sqlite3 --apply
cd backend
node --import tsx scripts/configure-user-testing.ts --manifest=../output/user-testing/U02/seed-manifest.json
node --import tsx scripts/configure-user-testing.ts --manifest=../output/user-testing/U02/seed-manifest.json --apply
```

Langflow lokal harus berjalan. Pengalihan mengubah path SQLite pada semua reader, validator dan writer di project MCP aktif; ID, kode, kredensial dan topologi flow tetap dipertahankan. Reader diuji lewat run Langflow terlebih dahulu lalu diverifikasi lewat MCP: 8 posko, 630 jiwa, seluruh catatan berlabel sintetis. Flow lama dicadangkan sebelum pengalihan; reader diaktifkan terakhir. Jika pengujian gagal, flow dikembalikan. File rollback dapat memuat kredensial, disimpan dalam `output/` yang diabaikan Git; jangan dibagikan kepada peserta.

Sesudah pengalihan, buka ulang halaman/sesi aplikasi sebelum mencoba data baru. Flow snapshot lama tetap terikat sumber/baseline lama dan tidak boleh disetujui pada database baru. Bila web belum berjalan: `docker compose up -d --build` dari root, lalu buka `http://127.0.0.1:5173/`. Konfigurasi model/API key tetap mengikuti `.env` root.

Untuk kembali ke konfigurasi flow sebelum tes (sesuaikan direktori):

```powershell
cd backend
node --import tsx scripts/configure-user-testing.ts --rollback=../output/user-testing/U02/deployment.json
node --import tsx scripts/configure-user-testing.ts --rollback=../output/user-testing/U02/deployment.json --apply
```

Database lama tidak ditimpa. Database uji berisi hasil tes tetap tersedia untuk audit. Rollback mengembalikan **pengaturan flow**, bukan menyalin hasil tes ke data lama. Rekap dan metadata sesi backend adalah dua database berbeda; tidak ada penghapusan metadata sesi oleh skrip ini.

## Mengumpulkan evidence

Gunakan kode peserta U01, U02, U03; minta izin sebelum mengambil rekaman atau mengutip feedback. Catat durasi, keberhasilan/sebagian/gagal, bantuan fasilitator dan komentar asli pada template. Screenshot yang berguna: rekap awal, hasil kandidat sebelum/sesudah koreksi, pilihan konflik, hasil simpan terverifikasi, serta buletin. Beri nama `U01-T02-koreksi.png`, misalnya. Jangan memasukkan key/token atau konfigurasi koneksi ke bukti.

Tanyakan tiga penilaian 1–5: kemudahan penggunaan, kejelasan hasil/peringatan, dan manfaat untuk pekerjaan posko. Tambahkan pertanyaan terbuka: bagian yang paling membingungkan, manfaat yang terasa, serta satu perbaikan yang paling dibutuhkan. Bila peserta bukan petugas/relawan, tulis latar belakang tersebut dengan jujur; jangan menyebutnya validasi kebutuhan lapangan. Bedakan hasil tes mock, integrasi live dan feedback peserta dalam laporan mentoring.

## Pemeriksaan kesiapan live

Saat Docker dan database baseline aktif, jalankan dari `frontend`: `npm run test:user-validation`. Skrip eksplisit `tests/user-validation/readiness.spec.ts` memeriksa 8 posko/630 jiwa, hasil hitung semua desa, stok nol versus gap belum diketahui, lalu respons model nyata. Tes tidak mengirim persetujuan simpan dan memblokir endpoint keputusan dari browser. Hasilnya ada pada `frontend/test-results-user-validation/` (diabaikan Git).

Status pemeriksaan 25 Oktober 2026: 72 tes browser mock desktop/ponsel, 32 unit frontend, 10 tes Python, dan build frontend/backend berhasil. Pembacaan serta kalkulasi database uji lewat Docker → MCP → Langflow berhasil. Provider GLM sebelumnya gagal dengan HTTP 429 / `FreeUsageLimitError`. Setelah model diganti menjadi `gemini/gemini-3.5-flash-lite(medium)`, tes kesiapan live berhasil: rekap 8 posko, kalkulasi seluruh posko dan jawaban model nyata, tanpa write. Akhiran `(medium)` dikirim sebagai parameter `reasoning_effort`, terpisah dari nama model API. Ini merupakan smoke test kesiapan, belum bukti seluruh skenario peserta berhasil pada model baru. Health `live` hanya menunjukkan konfigurasi; ulangi pemeriksaan kesiapan sebelum sesi peserta. Template feedback masih kosong dan tidak mengklaim validasi pengguna sudah dilakukan.
