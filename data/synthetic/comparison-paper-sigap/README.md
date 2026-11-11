# Uji perbandingan SIGAP dengan kertas/papan tulis

Status: protokol dan data sintetis, **belum merupakan hasil pengujian**.

Pertanyaan utama: apakah SIGAP membantu petugas memperbarui dan menemukan informasi posko lebih cepat, dengan akurasi yang setidaknya sebanding dengan pencatatan kertas/papan tulis?

## Berkas yang disiapkan

- `FORMAT-MANUAL.md`: lembar pencatatan dan tautan PDF kosong siap cetak.
- `REFERENSI-FORMAT.md`: pemetaan variabel BNPB, tambahan penelitian, dan batas klaim.
- [PDF kosong dua halaman siap cetak](../../../output/pdf/formulir-manual-uji-sigap.pdf): rekap pengungsi/stok dan ruang jawaban/serah terima. Cetak A4 mendatar, ukuran aktual.
- `PANDUAN-PESERTA.md`: dibaca peserta sebelum sesi.
- `PANDUAN-FASILITATOR.md`: persiapan, urutan, batas waktu dan penilaian; jangan diberikan kepada peserta.
- `PAKET-A.md` dan `PAKET-B.md`: kartu laporan yang diberikan bertahap, bukan seluruhnya sekaligus.
- `KUNCI-JAWABAN.md`: acuan penilai, disembunyikan dari peserta.
- `kunci-angka.json`: angka yang dapat diperiksa ulang secara otomatis.
- `observasi.csv`: satu baris per peserta, metode dan tugas.
- `alokasi.csv`: catat urutan yang sudah diundi sebelum pengujian.

## Rancangan

Setiap peserta melakukan kedua metode, menggunakan paket berbeda. Undi urutan dari empat kartu berikut; gunakan setiap kartu satu kali dalam setiap blok empat peserta. Simpan hasil undian. Bila peserta tidak kelipatan empat, laporkan ketidakseimbangan yang tersisa.

| Kartu | Sesi pertama | Sesi kedua |
| --- | --- | --- |
| S1 | Manual, A | SIGAP, B |
| S2 | SIGAP, B | Manual, A |
| S3 | Manual, B | SIGAP, A |
| S4 | SIGAP, A | Manual, B |

Manual berarti kertas **atau** papan tulis sesuai praktik narasumber. Pilih satu sebagai pembanding utama dan gunakan konsisten. Jika menguji keduanya, laporkan terpisah; jangan menggabungkannya sebagai satu perlakuan tanpa mencatat medianya.

Jika contoh asli belum tersedia, gunakan [lembar manual adaptasi](FORMAT-MANUAL.md) sebagai pembanding terstandar sementara. Variabel terpilih mengacu dokumen BNPB; tata letak, kolom stok terukur, dan lembar jawaban merupakan rancangan penelitian. Ini bukan formulir resmi dan belum diklaim sama dengan format narasumber. Validasi kecocokannya pada pilot sebelum sesi utama. Kedua metode memakai kartu laporan serta butir penilaian yang sama; tidak ada isian tambahan wajib pada metode manual.

Mulai dengan pilot untuk memeriksa kelayakan prosedur. Empat peserta pilot memungkinkan mencoba seluruh urutan, tetapi bukan jumlah yang membuktikan keunggulan statistik. Tetapkan kebutuhan peserta penelitian utama setelah melihat variasi waktu dan akurasi pilot. Rekrut calon pengguna di luar tim pembuat bila memungkinkan, dan catat pengalaman pencatatan serta pengalaman SIGAP.

Anggaran waktu awal: orientasi dan latihan sekitar 15 menit, maksimal 36 menit per metode, istirahat sekitar 10 menit. Sesuaikan berdasarkan pilot **sebelum** sesi utama; gunakan batas yang sama pada kedua metode. Jangan memakai angka batas ini sebagai hasil pengukuran.

## Batas klaim

Uji ini mengukur pekerjaan rekap beberapa posko pada kondisi online stabil. Ini belum mengukur dampak lapangan, keberhasilan distribusi bantuan, pergantian petugas sungguhan, atau keandalan offline. Tugas serah terima mengukur kualitas catatan, bukan pemahaman penerimanya. Pengujian offline dan serah terima dua orang dapat menjadi sesi lanjutan.

Rekomendasi desain disesuaikan dengan prinsip pengendalian faktor pengganggu NIST dan instruksi tugas netral GOV.UK:
- https://www.itl.nist.gov/div898/handbook/pri/section3/pri332.htm
- https://www.gov.uk/service-manual/user-research/using-moderated-usability-testing

