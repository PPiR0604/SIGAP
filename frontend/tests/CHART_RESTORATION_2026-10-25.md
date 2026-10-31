# Pemulihan diagram frontend — 25 Oktober 2026

Diagram dari desain sebelum perbaikan frontend dipulihkan dan dihubungkan ke state rekap aktif:

- **Laporan:** analisis kebutuhan Sphere, batang pemenuhan stok, proporsi balita/lansia/ibu hamil/disabilitas, diagram kategori kebutuhan per wilayah, serta peta skematis dengan penanda yang membuka detail posko.
- **Rekap:** diagram distribusi kategori kebutuhan, ringkasan kebutuhan hasil perhitungan server, dan pemetaan kebutuhan per wilayah.
- Pemilihan posko memperbarui diagram analisis. Koreksi yang diterima server memperbarui angka kelompok rentan dan kebutuhan, dengan mempertahankan posko lain.
- Legenda, label angka, keadaan data kosong, pembesaran diagram, keyboard, dan susunan mobile tersedia. Diagram tetap dirender ketika data belum ada.

Persentase memakai data yang tersedia: kategori menghitung kemunculan kategori per posko, sedangkan pemenuhan stok hanya memakai pasangan kebutuhan/kekurangan yang diberikan server. Kebutuhan pokok tidak dihitung ulang oleh frontend. Nilai nol tidak disamakan dengan data yang belum diketahui. Kelompok rentan ditampilkan sebagai batang terpisah karena anggotanya dapat saling tumpang tindih.

Peta diberi label **skematis**: posisi penanda dikelompokkan berdasarkan wilayah laporan dan tidak mengklaim koordinat geografis. Kecamatan digunakan jika tersedia; jika tidak, diagram memakai desa yang dilaporkan.

## Verifikasi

| Pemeriksaan | Hasil |
| --- | --- |
| `npm test` dari `frontend` | 36/36 unit test lolos |
| `npx playwright test --max-failures=4` | 96/96 tes lolos, 48 desktop + 48 mobile, tanpa retry/skip/flaky |
| Tes khusus `tests/e2e/charts.spec.ts` | Pemilihan posko, angka/proporsi, agregat kebutuhan, koreksi, keadaan kosong, zoom, dan keyboard penanda peta |
| `npm run build` serta build Docker | Berhasil |
| `docker compose up -d --build` | Frontend berjalan dan backend healthy |
| Frontend `http://127.0.0.1:5173/` | HTTP 200 |
| Backend `/api/health` | HTTP 200, backend ready, mode live |
| Langflow `http://127.0.0.1:7860/health` | HTTP 200 |
| Inisialisasi/list MCP Langflow | Berhasil; tujuh tool SIGAP terdeteksi |

File tes eksplisit: [`e2e/charts.spec.ts`](e2e/charts.spec.ts) dan [`chartData.test.ts`](chartData.test.ts). Hasil mesin suite lengkap berada di `test-results/results.json`; tangkapan layar tersedia di direktori hasil skenario `charts-*`.

Tes interaksi diagram memakai data sintetis melalui respons API/SSE terkontrol. Pemeriksaan layanan live membuktikan frontend/backend berjalan dan koneksi MCP tersedia; sesi pengguna Supabase dan panggilan model dengan akun nyata belum diuji. Pemeriksaan ini tidak menulis rekap operasional atau menjalankan tool penyimpanan.
