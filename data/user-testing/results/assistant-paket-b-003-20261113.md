# Uji ulang SIGAP Paket B — asisten, percobaan 003

Pengujian live pada 13 November 2026 memakai workspace baru `uji-paket-b-003-20261113` yang dikonfirmasi kosong sebelum timer dimulai. Operator adalah asisten, sudah membaca skenario dan kunci; hasil ini tidak mewakili pengujian pengguna manusia. Model aktif `zd/gpt-6-luna`, provider OpenAI-compatible. Tidak ada perubahan kode selama pengukuran.

Lingkup T01–T04, tanpa serah terima/buletin T05. Login, persiapan layanan dan pembuatan workspace tidak dihitung. Membaca, interaksi browser/tool, menunggu, koreksi, persetujuan, pembacaan ulang dan gangguan operator tetap dihitung; tidak ada waktu yang dikurangi.

| Tugas | Durasi | Butir data/jawaban benar |
| --- | ---: | ---: |
| T01 — catat dan simpan tiga posko | 3 menit 36,75 detik | 18/18 |
| T02 — pembaruan Karangmulya | 4 menit 50,92 detik | 9/9 |
| T03 — konflik, konfirmasi, pesan ulang | 5 menit 45,40 detik | 10/10 |
| T04 — enam pertanyaan | 43,16 detik | 6/6 |
| Jumlah durasi tugas | 14 menit 56,23 detik | 43/43 |
| Total waktu berjalan, termasuk perpindahan tugas | 14 menit 58,69 detik | — |

Timer memakai `perf_counter_ns` mulai 19:42:47,78 WIB sampai 19:57:46,47 WIB. Selisih total berjalan dan jumlah tugas adalah 2,45 detik perpindahan antartugas. Penanda waktu mentah berada pada `output/assistant-paket-b-003-20261113/timing.json`.

## Hasil yang tersimpan

| Posko — desa | Jiwa | Laki-laki | Perempuan | Stok air | Kebutuhan air/24 jam | Kekurangan air/24 jam |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Sejahtera — Karangmulya | 52 | 24 | 28 | 360 L/24 jam | 780 L | 420 L |
| Sejahtera — Cibening | 32 | 15 | 17 | 0 L/24 jam | 480 L | 480 L |
| Kenanga — Mekarsari | 48 | 23 | 25 | Belum diketahui | 720 L | Belum diketahui |

Total tiga posko, 132 jiwa, kebutuhan 1.980 L/24 jam. Kekurangan yang diketahui adalah 900 L/24 jam pada dua Sejahtera; angka tersebut bukan total kekurangan pasti seluruh posko. Pesan Cibening yang diteruskan ulang tidak menambah posko atau jiwa. Terdapat lima penulisan yang disetujui lewat UI: tiga pencatatan awal, satu pembaruan Karangmulya, dan satu konfirmasi Kenanga.

Skor 43/43 menilai data tersimpan pada setiap akhir tahap dan enam jawaban yang diserahkan operator. Tabel model T04 memberikan kebutuhan/gap per posko; asisten menjumlahkan populasi dan kebutuhan dari data tersebut serta menyusun penjelasan nol versus belum diketahui. Skor ini tidak berarti model menjawab enam pertanyaan lengkap secara mandiri atau antarmuka bebas bug.

## Gangguan yang tetap masuk hitungan

- Formulir koreksi kandidat Kenanga ditolak dengan `CORRECTION_TARGET_INVALID`. Operator mengirim kartu klarifikasi standar melalui chat, kemudian meninjau dan menyetujui kandidat baru.
- Kandidat Kenanga lama 46 jiwa tetap menutupi data tersimpan 48 jiwa pada tabel gabungan. Tabel gabungan menampilkan 130 jiwa; pembacaan seluruh rekap tersimpan mengonfirmasi 132 jiwa. Kandidat lama tidak disetujui. Masalah ini masih terbuka.
- Formulir edit Karangmulya sempat menampilkan nilai lama 44/20/24, sedangkan tab Data posko dan hasil simpan sudah 52/24/28. Operator tidak mengirim nilai formulir yang lama.
- Pratinjau T02 tidak membawa stok yang disebut pada kartu dan meminta keputusan metadata stok. Operator memilih jumlah jiwa baru dan mempertahankan metadata tersimpan; stok akhir tetap 360 L pada 08.00 untuk 24 jam.
- Pencarian Kenanga berdasarkan nama mengembalikan nol hasil. Tombol cek seluruh rekap tersimpan berhasil mengembalikan ketiga posko.
- Ada jeda otomasi karena tombol berikutnya sudah tidak tersedia, tombol persetujuan belum bisa dipakai sebelum konflik diputuskan, serta selector/label yang kurang tepat. Seluruh jeda tersebut tetap dihitung.

Status percobaan: selesai dengan gangguan teknis; belum memenuhi klaim alur yang bersih dari masalah. Tidak ada fasilitator yang memulihkan database atau kode saat timer berjalan. Klarifikasi standar dipakai setelah ketidaksesuaian 23 + 25 versus 46 terlihat pada UI. Tidak ada skor kemudahan manusia yang diisi.

## Batas perbandingan

Uji kertas Paket A yang dilaporkan pengguna berlangsung 15 menit 1,40 detik dengan dua kesalahan yang dilaporkan. Percobaan ini memakai operator dan paket berbeda, serta asisten mengetahui kunci dan mengalami jeda otomasi. Karena itu, jangan menghitung atau mempromosikan persentase penghematan waktu dari dua hasil tersebut.

Rincian penilaian setiap butir ada pada `assistant-paket-b-003-20261113.json`. Bukti lokal lain berada di `output/assistant-paket-b-003-20261113/`: timer, ekspor riwayat penyimpanan terbatas pada workspace uji, jawaban T04, snapshot UI, dan status permintaan. Workspace percobaan sebelumnya tetap tiga baris/revisi 3 dengan digest yang sama.
