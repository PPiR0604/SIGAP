# Data sintetis lanjutan SIGAP

Semua tambahan dalam paket ini adalah rekaan untuk demo, bukan data lapangan. Paket melanjutkan enam posko contoh di UI: Cibening, Harapan, Bening, Teduh, Melati, Nusa. Jumlah jiwa dipertahankan; Harapan memakai laki-laki 43, perempuan 55, lansia 16. Desa dan rincian yang tadinya kosong dilengkapi dengan nilai sintetis. Tidak ada data yang dimasukkan otomatis ke aplikasi atau penyimpanan.

## Melanjutkan rekap yang sudah disimpan

1. Gunakan file dalam `koreksi-per-posko/` satu per satu, mulai `01-cibening.txt`. Salin isinya ke chat Agent, atau unggah satu file `.txt` tiap giliran.
2. Tinjau hasil koreksi: pastikan target posko sesuai, posko lain tetap tersedia di rekap, dan angka tidak ditambah sebagai pengungsi baru.
3. Pilih **Tinjau & setujui**, lalu konfirmasi lewat UI bila sesuai. Tunggu **Tersimpan & Terverifikasi** sebelum mengirim koreksi posko berikutnya.
4. Ulangi sampai `06-nusa.txt`. Target memakai nama agar tidak bergantung pada ID/batch lama. Jika nama posko ambigu, gunakan **Tulis klarifikasi** di detail posko untuk mengambil ID/batch yang berlaku, lalu tambahkan rincian sintetis yang sesuai.
5. Gunakan pesan dalam `02-pesan-lanjutan-agent.txt` untuk membaca ulang rekap, menghitung kebutuhan, memeriksa laporan, dan menyusun pratinjau buletin.

Jangan mengirim keenam pesan koreksi sekaligus: alur koreksi memilih satu target per giliran. Lengkapi desa melalui koreksi target agar baris asal yang desanya kosong diperbarui secara eksplisit.

## Alternatif laporan lengkap

`01-laporan-lengkap-6-posko.txt` berisi laporan lengkap siap diunggah. Gunakan untuk pratinjau seluruh batch atau demo baru. Untuk rekap yang sudah ada, gunakan koreksi per posko di atas; penulisan laporan baru yang desanya berbeda dari baris lama dapat membuat identitas posko baru. Jangan menyetujui batch baru jika terlihat duplikat.

## Hasil yang diharapkan

- Enam posko, total **552 jiwa**; semua jumlah laki-laki + perempuan sama dengan total posko.
- Semua rincian wajib tersedia, termasuk nol eksplisit; Melati menjadi hasil hitung pasti, bukan estimasi.
- Daftar kebutuhan mencakup air, beras, minyak, popok, obat, makanan siap saji, perlengkapan kebersihan, selimut, dan makanan bayi.
- Teduh melaporkan air dan pangan cukup; status cukup hanya berlaku di Teduh.
- Stok Bening untuk air adalah **0 L**, sehingga gap air 1.500 L saat stok masih segar.
- Nusa memakai stok untuk **24 jam** dalam pembaruan ini, menggantikan periode 48 jam di laporan contoh sebelumnya.
- Nilai per posko dan gap ada di `nilai-yang-diharapkan.json`. Ini rujukan pemeriksaan, bukan payload untuk melewati validator/approval.

Waktu laporan/stok dibuat mendekati saat paket disiapkan. Hitungan gap bergantung pada jumlah, unit, waktu stok, dan periode 24 jam yang disebut dalam teks. Untuk simulasi di hari lain, perbarui tanggal/jam secara konsisten; stok contoh ini bukan bukti stok terkini.

## File koreksi

- [Cibening](koreksi-per-posko/01-cibening.txt)
- [Harapan](koreksi-per-posko/02-harapan.txt)
- [Bening](koreksi-per-posko/03-bening.txt)
- [Teduh](koreksi-per-posko/04-teduh.txt)
- [Melati](koreksi-per-posko/05-melati.txt)
- [Nusa](koreksi-per-posko/06-nusa.txt)
