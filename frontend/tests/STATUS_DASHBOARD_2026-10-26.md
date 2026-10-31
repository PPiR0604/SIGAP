# Dashboard pengganti peta — 26 Oktober 2026

Peta skematis diganti kartu **Status Pemeriksaan Posko** pada halaman Laporan dan Rekap. Kartu menampilkan total posko, diagram donat empat status beserta jumlah/persentase dalam teks, dan daftar posko yang dapat dibuka untuk pemeriksaan. Klik status menyaring daftar; tombol Perlu ditinjau dan Semua posko mengembalikan cakupan daftar. Pagination memastikan seluruh posko dapat diakses.

Angka memakai status rekap aktif, termasuk perubahan kandidat, tanpa menandai status Siap ditinjau sebagai sudah terverifikasi atau menganggap pemeriksaan data sebagai tingkat kedaruratan. Keadaan kosong tidak mengisi angka contoh. Tidak ada dependensi peta atau API geografis.

Validasi implementasi:

- Build TypeScript dan Vite: lulus.
- `npx playwright test charts.spec.ts --max-failures=2`: 14/14 lulus, desktop dan mobile.
- Tes memeriksa empat status dengan proporsi 25%, filter melalui keyboard, pembukaan detail, pagination, pembaruan data, keadaan kosong, serta diagram kebutuhan dan kelompok rentan yang tetap tersedia.
- Tangkapan layar dashboard desktop dan mobile diperiksa.
- Pengujian memakai server terisolasi dan data tiruan; tidak menulis rekap operasional.

Dokumen pemulihan diagram tanggal 25 Oktober merekam desain sebelumnya; kartu ini menggantikan peta skematis pada desain tersebut.
