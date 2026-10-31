# Acuan fasilitator — jangan bagikan jawaban sebelum tugas

## Persiapan

1. Siapkan satu peserta per ruang data uji yang terisolasi. Jika rekap dipakai bersama, jalankan peserta bergiliran dan pulihkan baseline sebelum peserta berikutnya. Refresh browser hanya membuat sesi percakapan baru; tidak mengembalikan isi database.
2. Periksa sumber penyimpanan yang sedang dipakai aplikasi. Baseline yang dibutuhkan adalah `../baseline.json`: 8 posko, 630 jiwa. Dalam mode pendaftaran pengujian Supabase, akun baru otomatis mendapat salinan baseline di ruang latihan masing-masing. Akun yang dibuat sebelumnya tidak di-reset; pastikan rekapan awalnya sesuai sebelum sesi. Skrip SQLite pada [panduan lama](../README.md) hanya sesuai lingkungan SQLite; jangan memakainya untuk mengasumsikan database Supabase ter-reset.
3. Pastikan akun peserta memiliki izin olah laporan dan simpan di ruang operasi tersebut. Fitur pengelolaan komando yang dibahas pada chat rujukan tidak otomatis berarti seluruh UI admin sudah tersedia. Jangan meminta peserta membuat komando atau memilih role sendiri.
4. Baca rekap dan jalankan hitung kebutuhan tanpa write untuk memastikan koneksi/model siap. Jika provider gagal atau rekap awal berbeda, tandai sesi belum siap; jangan mencatatnya sebagai kegagalan peserta.
5. Gunakan tanggal input 25 Oktober 2026 (WIB) dan baseline tanggal yang sama, atau ganti tanggal seluruh input serta seed secara konsisten. Jangan kirim koreksi bertanggal lebih lama daripada versi tersimpan. Jika menguji indikator laporan senyap, catat juga jam pengujian; indikator umur laporan tidak menjadi acuan lulus paket ini.
6. Minta izin pengambilan screenshot/rekaman dan pengutipan komentar. Catat kode peserta, latar belakang, perangkat, browser, mode mock/live, versi aplikasi, dan ruang data uji. Tidak perlu merekam nomor pribadi peserta.

## Hasil yang diharapkan

Angka berikut adalah **acuan pengujian**, bukan hasil pengujian yang sudah dilaksanakan. Urutan normal memilih semua nilai baru dan menyimpan hanya melalui konfirmasi eksplisit.

| Tugas | Pemeriksaan utama | Rekap tersimpan setelah tugas |
| --- | --- | --- |
| T01 | Harapan Sukamaju dan Harapan Cipandan berbeda; Melati belum lengkap, Pelita stok nol | 8 posko / 630 jiwa |
| T02 sebelum konfirmasi | Kandidat Anggrek 50 dan Kenanga 64; belum mengubah rekap tersimpan | 8 / 630 |
| T02 setelah kedua kandidat disimpan | Anggrek 24+26=50; Kenanga 30+34=64; hasil dibaca ulang | 10 / 744 |
| T03 | Harapan Sukamaju 102, laki-laki 47, perempuan 55, lansia 14, disabilitas 2; Cibening 104/57/47/lansia 9; Harapan Cipandan tetap 40 | 10 / 752 |
| T04 | Teduh 80→84 dan Harapan **Cipandan** 40→44; Harapan Sukamaju tetap 102 | 10 / 760 bila keduanya memakai nilai baru |
| T05 | Melati tetap 63; rincian 30+33, disabilitas nol sah, stok 300 L/24 jam; setelah klarifikasi final, status estimasi perlu diperiksa | 10 / 760 |
| T06 | 35+40=75, berbeda dari total 70; sistem meminta klarifikasi/menandai konflik; tidak menyatakan otomatis benar | 10 / 760, tidak menyimpan Posko Uji Konflik |
| T07 | Laporan yang sama tidak boleh otomatis menambah posko/jiwa; boleh meminta review atau menandai duplikat; kandidat ulang tidak disetujui | 10 / 760 |
| T08 | Hanya memakai rekap disetujui; tidak memasukkan Uji Konflik/kandidat ulang; tidak mempublikasikan | 10 / 760 |

Jika T04 mempertahankan semua nilai lama, jumlah tetap **752 jiwa**. Jika hanya satu perubahan +4 diterima, jumlah **756 jiwa**. Ini keputusan sah; hitung acuan sesuai pilihan peserta. Pada tugas lain yang sebagian kandidatnya belum disimpan, bandingkan hanya perubahan yang benar-benar sudah disetujui dan terverifikasi baca ulang. Tampilan dapat menggabungkan kandidat dan rekap; acuan jumlah dalam tabel khusus **data tersimpan**.

Kalkulasi memakai koefisien yang sudah dikonfigurasi proyek: air 15 L/orang/hari dan pangan 2.100 kkal/orang/hari. Ini acuan perilaku aplikasi, bukan rekomendasi operasional baru.

| Kondisi/posko | Air L/hari | Pangan kkal/hari | Gap air yang bisa dibandingkan |
| --- | ---: | ---: | --- |
| Baseline 630 jiwa | 9.450 | 1.323.000 | Jangan jumlahkan gap yang belum diketahui |
| Setelah T02, 744 jiwa | 11.160 | 1.562.400 | Bergantung kelengkapan stok per posko |
| Setelah T03, 752 jiwa | 11.280 | 1.579.200 | Bergantung kelengkapan stok per posko |
| Setelah T04 nilai baru dan T05, 760 jiwa | 11.400 | 1.596.000 | Bergantung kelengkapan stok per posko |
| Anggrek 50 jiwa, stok 300 L/24 jam | 750 | 105.000 | 450 L/hari |
| Kenanga 64 jiwa, stok 0 L/24 jam | 960 | 134.400 | 960 L/hari |
| Melati setelah klarifikasi, 63 jiwa, stok 300 L/24 jam | 945 | 132.300 | 645 L/hari |

Gap di atas berlaku jika tanggal, horizon, dan kesegaran stok diterima validator pada saat uji. Stok Nusa **2.000 L untuk 48 jam** tidak langsung dikurangkan dari kebutuhan per hari atau otomatis dibagi dua; tanpa konfirmasi kesetaraan periode, gap tetap belum dapat dipastikan. Kelompok rentan dapat beririsan dan tidak dijumlahkan sebagai orang unik.

## Pemeriksaan nomor telepon dummy

Nomor berikut dibuat untuk isi laporan dan pengujian pola penyamaran. Nomor tidak diambil dari kontak nyata, tidak diverifikasi aktif/tidak aktif, dan tidak diklaim sebagai rentang resmi yang dicadangkan. Semua diperlakukan sebagai PII meskipun sintetis.

| Penggunaan | Nomor dummy di input |
| --- | --- |
| Anggrek — pengirim dan PIC Arman | `081200000101` / `085600000201` |
| Kenanga — pengirim dan PIC Ratna | `+6281200000102` / `0822-0000-0202` |
| Harapan Sukamaju | `0812-0000-0103` / `081200000103` |
| Cibening | `6281200000104` |
| Teduh dalam CSV | `081200000105` |
| Harapan Cipandan dalam CSV | `+6281200000106` |
| Melati | `0812.0000.0107` / `081200000107` |
| Laporan konflik | `+6281200000108` |

Nomor masih terlihat saat peserta mengetik atau melihat pratinjau input lokal. Yang harus diperiksa adalah **teks sesudah pemrosesan**, respons agen, kandidat olahan, rekap hasil, dan buletin: nomor lengkap tidak boleh ikut terpapar. Backend memakai penanda `[TELEPON]`; jalur preprocessor Langflow dapat memakai `[NO_HP]`. Keberadaan penanda saja belum membuktikan semua nomor sudah disamarkan.

T02 memuat **4** nomor (dua pengirim dan dua PIC), T04 CSV **2**, dan setiap berkas koreksi/parsial/invalid **1**. Jika UI tidak menampilkan ringkasan penyamaran, fasilitator dapat memeriksa `filtered_text` dan `pii_summary.phoneCount` dari respons pengiriman laporan melalui alat pengembang. Simpan bukti yang telah dibersihkan dari cookie, token, dan header autentikasi. Jangan menganggap penyamaran lulus hanya karena model tidak mengulang nomor dalam satu jawaban; pemeriksaan data yang dikirim ke model perlu bukti di jalur pemrosesan.

## Pencatatan dan kriteria

Gunakan [template-observasi.csv](template-observasi.csv). Satu baris mewakili satu peserta/tugas, bukan satu posko. Isi hasil `berhasil`, `sebagian`, `gagal`, atau `tidak_dijalankan`; catat pilihan lama/baru, durasi, bantuan, gejala yang terlihat, dan path bukti. Jangan mengisi jawaban peserta atau nilai kepuasan dengan data contoh.

- **Berhasil:** tujuan tercapai, data tersimpan/preview sesuai tugas, tanpa bantuan instruksional tambahan.
- **Sebagian:** tujuan hanya sebagian tercapai atau perlu bantuan; jelaskan penyebab dan bagian yang berhasil.
- **Gagal:** tujuan tidak tercapai atau data berubah keliru. Catat pesan asli serta tindakan terakhir.
- **Tidak dijalankan:** tugas dilewati atau lingkungan tidak tersedia; jangan masukkan ke denominator tugas yang dicoba.

Catat waktu mulai/selesai atau durasi detik. Persentase berhasil = tugas berstatus berhasil ÷ tugas yang benar-benar dicoba × 100%. Laporkan bantuan secara terpisah. Klaim penghematan waktu memerlukan pembanding pengerjaan manual dengan lingkup data setara; durasi penggunaan SIGAP saja belum membuktikan waktu yang dihemat.

Screenshot yang berguna: awal T01, kandidat sebelum simpan T02, dua kandidat T03, pilihan konflik T04, klarifikasi T05, peringatan T06, dan pratinjau buletin T08. Contoh nama: `U01-T03-kandidat-harapan.png`. Selalu bedakan hasil otomatis Playwright, integrasi live, dan observasi peserta. Jika peserta bukan petugas/relawan, tulis sebagai uji kegunaan oleh pengguna umum.

Hentikan tindakan tulis pada sesi jika data antarposko tertukar, perubahan tersimpan sebelum persetujuan, atau nomor lengkap bocor ke hasil olahan. Catat bukti dan laporkan sebagai temuan; jangan menebak perbaikannya atau melanjutkan persetujuan kandidat bermasalah.
