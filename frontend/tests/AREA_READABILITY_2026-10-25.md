# Keterbacaan kebutuhan wilayah — 25 Oktober 2026

Batang bertumpuk diganti batang terpisah dengan nama kategori dan jumlah `x dari n posko`. Semua wilayah memakai skala jumlah posko yang sama; angka bukan volume barang, pemenuhan stok, atau prioritas kedaruratan. Satu posko dihitung sekali dalam setiap kategori, sesuai agregasi sebelumnya.

Pencarian lokal dan empat wilayah per halaman menggantikan gulir di dalam panel. Daftar posko tetap bisa dibuka melalui tombol dengan keyboard, lalu masing-masing posko membuka detail yang sama. Pembaruan data tetap membatasi halaman ke rentang yang valid. Diagram lain dan peta skematis tetap tersedia.

Validasi:

- `npm run build`: lulus.
- `npx playwright test charts.spec.ts --max-failures=2`: 10/10 lulus, desktop dan mobile, termasuk lebar 375 px.
- Tes memeriksa label dan penyebut, perbandingan lebar batang untuk jumlah 2 versus 1, daftar posko, pencarian, halaman, pembaruan data, keadaan kosong, serta diagram Sphere dan kelompok rentan.
- `git diff --check`: lulus.
- Pengujian menggunakan respons SSE tiruan dan server terisolasi; tidak menyimpan atau mengganti data operasional.
