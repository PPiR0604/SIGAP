# Verifikasi frontend setelah pembaruan desain — 25 Oktober 2026

## Perbaikan

- Kartu laporan membaca posko dari state server dan menyediakan pemilihan posko. ID `R001` tidak lagi memicu penggantian dengan data desain. Nilai nol ditampilkan sebagai nol; data yang belum tersedia tetap ditandai belum diketahui.
- Percakapan contoh, identitas petugas, angka logistik, waktu rilis, dan hash persetujuan contoh tidak lagi ditampilkan sebagai informasi sesi pengguna. Ringkasan, daftar kebutuhan, dan metadata berasal dari rekap aktif.
- Filter pencarian, status, dan desa bekerja pada data aktif. CSV memakai seluruh hasil filter, termasuk baris di halaman lain. Pagination mengikuti jumlah baris dan mengembalikan halaman valid setelah filter berubah.
- Tab Posko/Kebutuhan dan tombol ciutkan/buka percakapan merupakan kontrol yang terlihat dan dapat digunakan. Tombol kirim terkunci selama pemrosesan. Persetujuan memerlukan kandidat dan snapshot; keputusan konflik tetap melalui dialog konfirmasi.
- Tabel tetap bergulir di dalam panelnya. Overflow yang membuat layout viewport mobile melebar dari 412 menjadi 620 piksel sudah diperbaiki. Notifikasi tidak lagi menghalangi klik navigasi atau tombol di bawahnya; tombol tutup notifikasi tetap dapat digunakan.
- Login disesuaikan dengan endpoint Supabase Auth yang sudah disediakan backend: pemulihan sesi, penyegaran token, logout, status akun, dan pemilihan pos komando dari scope server. Token produksi disimpan dalam session storage; token fixture lokal hanya dipakai oleh backend tes yang diinjeksi.
- Backend pengujian memakai repository SQLite in-memory yang diinjeksi secara eksplisit. Persyaratan Supabase pada backend produksi tetap dipertahankan.
- Watcher Vite mengabaikan direktori laporan dan artefak Playwright agar penulisan hasil tes tidak memicu reload workspace yang sedang digunakan.

## Pengujian eksplisit

Skenario baru tersimpan dalam [`e2e/frontendRefresh.spec.ts`](e2e/frontendRefresh.spec.ts). Cakupannya meliputi nilai nol/ID R001, pemilihan posko, 41 baris hingga halaman kelima, filter setelah pagination, geometri viewport dan klik persetujuan, login berhasil/ditolak, scope pos komando, logout, refresh token kedaluwarsa, dan pembatasan akun pending.

Suite yang sudah ada juga memeriksa perubahan nama/desa, klarifikasi bergantian, hasil perhitungan yang datang saat mengedit, isolasi persetujuan tiap kandidat, konflik impor CSV, kegagalan request, unggahan tidak valid, Markdown chat/buletin, splash screen, dan panel persetujuan.

Hasil akhir:

| Perintah dari direktori `frontend` | Hasil |
| --- | --- |
| `npm run build` | Berhasil; TypeScript dan Vite |
| `npm test` | 32/32 unit test lolos |
| `npx playwright test --max-failures=3` | 90/90 tes lolos; 45 desktop Chromium dan 45 mobile Chromium |
| `npx playwright test startup.spec.ts --project=desktop-chromium` | 2/2 tes lolos setelah penyesuaian watcher Vite; build dijalankan ulang dan berhasil |
| `git diff --check` | Tidak ada kesalahan whitespace |

Suite lengkap Playwright selesai tanpa retry, skip, atau tes flaky; durasi sekitar 118 detik. Hasil mesin untuk perintah terakhir tersedia di `frontend/test-results/results.json`, laporan HTML di `frontend/playwright-report/`, dan tangkapan layar tiap skenario disimpan dalam direktori hasil tes. Perintah berikutnya menggantikan laporan sebelumnya; hasil terakhir saat audit ini ditulis adalah smoke test startup setelah perubahan watcher. Direktori hasil tes diabaikan Git.

## Batas verifikasi

Tes browser memakai backend simulasi dan respons auth/SSE yang dikendalikan untuk menghindari perubahan data pengguna. Ini menguji kontrak frontend dengan API serta perilaku UI, bukan keberhasilan login Supabase nyata, eksekusi model/MCP/Langflow, atau penyimpanan operasional. Docker Desktop tidak aktif saat pemeriksaan (`docker compose ps` gagal terhubung ke Docker engine), sehingga integrasi live belum diuji ulang.

Kalkulasi kebutuhan yang ditampilkan berasal dari hasil server. Ketiadaan hasil kalkulasi tidak digantikan angka estimasi yang dihitung frontend. Sebaran posko dikelompokkan menurut desa yang dilaporkan karena data koordinat belum tersedia.
