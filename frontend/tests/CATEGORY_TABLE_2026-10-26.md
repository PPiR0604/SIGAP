# Tabel dan aksi kebutuhan — 26 Oktober 2026

Varian **Tabel dan aksi** dipilih pengguna dan diterapkan menggantikan batang distribusi kategori. Setiap kategori menampilkan jumlah dari total posko dalam rekap, diurutkan dari jumlah terbesar, dengan tombol Lihat posko. Tidak ada persentase kemunculan kategori atau legenda warna yang harus dicocokkan.

Tombol menerapkan filter kategori pada tabel rekap, membersihkan pencarian/status/desa lama, membuka tampilan Posko, mengembalikan halaman pertama, dan memindahkan fokus serta posisi halaman ke hasil di bawah header aplikasi. Filter aktif memiliki tombol Hapus filter kebutuhan. Unduhan CSV memakai seluruh hasil filter, bukan hanya halaman yang terlihat.

Agregasi dan filter berbagi fungsi klasifikasi yang sama; satu posko tetap dihitung sekali per kategori. Kategori Lainnya hanya cocok dengan kebutuhan yang tidak masuk kategori bernama. Jumlah terlapor tidak dianggap sebagai jumlah barang, tingkat kedaruratan, atau bukti pemenuhan stok. Kategori tanpa laporan tidak memiliki aksi kosong.

Pengujian terarah `categoryTable.spec.ts` dan `charts.spec.ts`: 24/24 lulus. Unit frontend: 38/38 lulus. Build TypeScript dan Vite lulus. Tangkapan layar tabel desktop serta mobile diperiksa, termasuk viewport 320 px. Tes tabel rekap lama diperjelas cakupannya ke region Tabel rekap posko karena halaman sekarang memiliki dua tabel dengan fungsi berbeda.

Regresi lengkap: **148/148** lulus pada desktop dan mobile. Setelah penyempurnaan jarak antarkolom dan penamaan grup hasil untuk aksesibilitas, 10/10 skenario tabel diuji ulang dan lulus. Artefak tes browser dikecualikan dari konteks build Docker agar video/laporan pengujian tidak ikut dikirim ke builder.

Tes menggunakan respons SSE terkontrol dan database server uji di memori; tidak menyimpan perubahan data operasional.
