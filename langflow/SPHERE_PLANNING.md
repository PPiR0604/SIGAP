# Rincian populasi dan acuan pangan/air SIGAP

## Acuan dan batas penggunaan

- [Sphere Handbook 2018, WASH 2.1, hlm. 105–107](https://spherestandards.org/wp-content/uploads/Sphere-Handbook-2018-EN.pdf#page=130): acuan awal air domestik 15 L/orang/hari, disesuaikan konteks. Ini mencakup minum, memasak, dan kebersihan; bukan anjuran konsumsi air minum individu.
- [Sphere 2018, standar pangan 6.1 dan Lampiran 6, hlm. 198–199 dan 231–232](https://spherestandards.org/wp-content/uploads/Sphere-Handbook-2018-EN.pdf#page=260): acuan populasi 2.100 kkal, protein 53 g, dan lemak 40 g per orang per hari. Nilai tabel sudah dibulatkan. Sphere juga menjelaskan acuan kontribusi energi protein 10–12% dan lemak 17%.
- Nilai tersebut bukan kebutuhan spesifik satu kelompok umur atau resep individu. Mikronutrien, kebutuhan khusus dan makanan yang sudah tersedia tetap perlu penilaian. Angka pada panel tidak membuktikan kecukupan menu.
- Karbohidrat **bukan target minimum tersendiri dari Sphere**. Ekuivalen skenario dihitung dari sisa energi: `(2100 − 4×53 − 9×40) / 4 = 382 g`. Faktor energi umum 4/4/9 berasal dari [FAO/WHO/UNU, Human energy requirements](https://www.fao.org/4/y5686e/y5686e04.htm). Ini bukan konversi menjadi beras, menu, atau suplemen.

## Definisi operasional usia

Pengguna mengonfirmasi balita 0–4 tahun terpisah dari anak 5–17 tahun pada 30 Oktober 2026. Lansia mengikuti kategori yang dilaporkan. Dewasa merupakan sisa total dikurangi ketiganya; tidak dihitung bila salah satu angka kosong/tidak valid atau jumlah kelompok melebihi total.

Tabel usia membagi **alokasi acuan populasi** menggunakan jumlah anggota kelompok. Angka bukan AKG menurut umur. Ibu hamil, ibu menyusui, dan disabilitas merupakan subkelompok yang dapat tumpang tindih sehingga tidak ditambahkan ke total usia. Untuk merencanakan ransum menurut kebutuhan umur sebenarnya, diperlukan profil usia/jenis kelamin lebih rinci serta asesmen gizi.

Kosong tetap tidak diketahui; nol adalah angka yang dilaporkan. Bila usia belum lengkap, hanya alokasi untuk kelompok dengan data valid yang tersedia, jumlah dewasa kosong, dan tidak ada total kelompok yang seolah lengkap. Bila jumlah usia tidak konsisten, alokasi kelompok diblokir.

## Implementasi

`components/needs_gap_calculator.py` menghasilkan payload tambahan `planning`, versi `sphere2018-population-v1`. Kalkulasi tetap deterministik di Langflow. Empat metrik dan peraturan gap stok sebelumnya tetap tersedia; makro yang baru bukan stok baru dan tidak menghasilkan klaim kekurangan protein/karbohidrat tanpa data inventaris.

Backend memvalidasi bentuk, rentang angka dan keunikan kelompok. Frontend hanya menampilkan output server. Perubahan data usia membatalkan cache rincian posko terkait; kalkulasi posko lain dipertahankan. Output flow lama tanpa `planning` menampilkan tombol **Hitung kebutuhan rinci**, bukan angka hasil perkiraan frontend. Tidak ada migrasi tabel atau pengubahan jumlah jiwa tersimpan.

Rincian jiwa dipakai bersama pada pratinjau dan dialog melalui `PopulationDetails.tsx`. `SphereNeedsDetails.tsx` menampilkan total, makro, alokasi usia, batas data, dan rujukan.

## Verifikasi dan sinkronisasi

```powershell
python -m unittest langflow.tests.test_sphere_planning langflow.tests.test_sqlite_migration
python langflow/scripts/sync_sphere_calculator.py --flow-id 2de08b3c-04e1-43f5-9a61-21f4c5dff8e3 --apply --probe
```

Sinkronisasi mempertahankan identitas flow, autentikasi, koneksi dan pengaturan penyimpanan. Probe membuat flow privat sementara dengan sumber sintetis tetap, menjalankan graph Langflow nyata, membandingkan hasil, lalu menghapus flow probe. Probe tidak membaca atau menulis posko operasional dan tidak menguji distribusi bantuan. Cadangan dan bukti tersimpan lokal di `backend/data/langflow-backups/`, yang diabaikan Git.

Tes mencakup konsistensi total, tidak menghitung kelompok tumpang tindih dua kali, nol/kosong/angka tidak valid, sumber snapshot, kompatibilitas kontrak, pembatalan cache saat koreksi, serta UI desktop/ponsel. Rekomendasi menu dan verifikasi kecukupan klinis bukan keluaran fitur ini.
