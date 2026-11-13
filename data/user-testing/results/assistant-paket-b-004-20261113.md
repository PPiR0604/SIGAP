# Uji SIGAP Paket B — asisten, percobaan 004

Pengujian live dilakukan pada 13 November 2026 di workspace baru `uji-paket-b-004-20261113`, yang kosong sebelum timer dimulai. Akun Admin Demo dan layanan sudah siap. Operator adalah asisten yang telah membaca skenario serta kunci; ini bukan hasil pengujian peserta manusia. Model aktif: `zd/gpt-6-luna` melalui provider OpenAI-compatible.

Lingkup tetap T01–T04, tanpa serah terima/buletin T05. Membaca, interaksi browser/tool, menunggu AI, memeriksa, mengoreksi dan menyetujui semuanya dihitung. Tidak ada perubahan kode atau pengurangan waktu gangguan selama pengukuran; hash perubahan aplikasi sebelum/sesudah cocok.

| Tugas | Durasi | Butir data/jawaban benar |
| --- | ---: | ---: |
| T01 — pencatatan tiga posko | 1 menit 9,13 detik | 18/18 |
| T02 — pembaruan Karangmulya | 1 menit 1,47 detik | 9/9 |
| T03 — konflik, klarifikasi dan pesan ulang | 2 menit 8,43 detik | 10/10 |
| T04 — enam pertanyaan | 26,74 detik | 6/6 |
| Jumlah waktu tugas | 4 menit 45,77 detik | 43/43 |
| Total berjalan, termasuk perpindahan tugas | 4 menit 46,07 detik | — |

Timer memakai `perf_counter_ns`, mulai 23:51:21,81 WIB sampai 23:56:07,88 WIB. Selisih 0,30 detik antara total berjalan dan jumlah waktu tugas merupakan perpindahan antartugas. Persiapan, login dan pembuatan workspace tidak dihitung.

## Hasil akhir

| Posko — desa | Jiwa | Laki-laki | Perempuan | Stok air | Kebutuhan air/24 jam | Kekurangan air/24 jam |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Sejahtera — Karangmulya | 52 | 24 | 28 | 360 L/24 jam, dicek 08.00 | 780 L | 420 L |
| Sejahtera — Cibening | 32 | 15 | 17 | 0 L/24 jam, dicek 08.02 | 480 L | 480 L |
| Kenanga — Mekarsari | 48 | 23 | 25 | Belum diketahui | 720 L | Belum diketahui |

Total tiga posko, 132 jiwa, kebutuhan air 1.980 L/24 jam. Kekurangan yang dapat dihitung adalah 900 L/24 jam pada dua Sejahtera; kekurangan pasti seluruh posko belum diketahui karena stok Kenanga belum tersedia.

Riwayat penyimpanan membuktikan kondisi T01, T02, dan T03. Ada enam write yang disetujui melalui UI: tiga pencatatan awal, satu pembaruan Karangmulya, satu koreksi Kenanga, dan satu pembaruan catatan pesan terusan Cibening. Jumlah posko tetap tiga. Seluruh pengiriman pesan dan keputusan terkait menerima HTTP 202. Tercatat nol event error server dan nol snapshot review yang masih menunggu pada akhir percobaan.

## Temuan alur

- T01: ketiga pesan dikenali terpisah. Angka 44/20/24, 32/15/17, serta 46/belum diketahui/belum diketahui sesuai sumber. Stok 360 L, stok nol, dan stok belum diketahui tetap berbeda.
- T02: konflik hanya pada jumlah jiwa/laki-laki/perempuan. Stok 360 L dan waktu cek 08.00 tetap berlaku walaupun waktu laporan berubah menjadi 08.20. Formulir yang dibuka kembali menampilkan 52/24/28.
- T03: ketidaksesuaian 23 + 25 versus total 46 terlihat sebelum kartu klarifikasi dipakai. Koreksi melalui formulir berhasil pada upaya pertama; tidak perlu kirim ulang lewat chat. Kandidat 46 jiwa tergantikan, lalu 48/23/25 tersimpan dan tabel tetap menampilkan total 132.
- Pesan terusan Cibening tidak menambah posko atau jiwa, tetapi model menambahkan catatan bahwa pesan diteruskan ulang. Catatan ini tetap menghasilkan satu tinjauan/persetujuan tambahan. Biayanya masuk ke waktu T03; ini masih menjadi peluang penyederhanaan alur.
- T04: keluaran SIGAP langsung menyebut tiga posko, 132 jiwa, 1.980 L/24 jam dan tabel gap 420/480/belum diketahui. Asisten menyusun enam jawaban bernomor dan menjelaskan nol versus stok belum diketahui berdasarkan data yang telah diperiksa. Skor 6/6 menilai jawaban operator tersebut, bukan klaim model menjawab keenam nomor secara mandiri.
- Ada satu kesalahan selector otomasi pada T02 karena nilai 52 muncul di tiga elemen. Navigasi dilanjutkan melalui halaman konflik. Tidak ada waktu yang dihapus dari pengukuran.

## Arti hasil ini

Percobaan asisten 003 sebelumnya membutuhkan 14 menit 58,69 detik, dengan gangguan formulir dan kandidat lama. Percobaan 004 ini membutuhkan 4 menit 46,07 detik. Perbaikan aplikasi dan otomasi/navigasi yang lebih lancar sama-sama dapat berkontribusi; satu pengulangan tidak memisahkan pengaruh masing-masing.

Hasil manual Paket A yang dilaporkan pengguna adalah 15 menit 1,40 detik dengan dua kesalahan yang dilaporkan. Operator, paket dan tingkat familiaritas berbeda dari percobaan asisten ini. Jangan memakai perbandingan tersebut sebagai persentase penghematan waktu pengguna manusia. Pengujian peserta yang sebanding tetap diperlukan.

Penilaian per butir dan data tahap ada di `assistant-paket-b-004-20261113.json`. Bukti lokal tersedia di `output/assistant-paket-b-004-20261113/`: timer, hash setup, riwayat penyimpanan, jawaban T04, snapshot UI dan status permintaan. Hasil percobaan sebelumnya dipertahankan.
