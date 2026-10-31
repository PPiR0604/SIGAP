# Sampel OCR sintetis

Gunakan berkas berikut untuk mencoba **Unggah berkas** di tab Laporan. Gambar PNG/JPG juga dapat disalin dan ditempel ke kotak chat:

- `laporan-posko.png` / `.jpg`: Posko Harapan, Desa Sukamaju, 100 jiwa, laki-laki 40, perempuan 60, lansia 12, disabilitas 0, kebutuhan air bersih dan beras.
- `laporan-dua-halaman.pdf`: scan dua halaman; halaman kedua Posko Melati, Desa Cibening, 80 jiwa, laki-laki 30, perempuan 50.
- `gambar-kosong.png`: harus menghasilkan pesan tidak ada teks yang terbaca.
- `enam-halaman-ditolak.pdf`: harus ditolak karena batas lima halaman.

Semua data buatan. Pembacaan dan penggunaan teks tidak otomatis menyimpan rekap. Periksa teks OCR sebelum menekan Kirim dan tetap tinjau kandidat sebelum menyetujui penyimpanan.

Untuk membuat ulang, jalankan `python data/synthetic/ocr/generate.py` dari root repositori. Generator membutuhkan Pillow dan font Arial atau DejaVu Sans.
