# Audit UI edit data — 25 Oktober 2026

Pengujian memakai plugin Playwright untuk eksplorasi web Docker, lalu tes eksplisit untuk reproduksi dan regresi. Model live: `gemini/gemini-3.5-flash-lite(medium)`; flow Langflow dan MCP nyata. Data awal: 8 posko sintetis / 630 jiwa. Tidak ada persetujuan simpan yang dikirim pada tes live.

## Temuan dan perbaikan

| Temuan | Reproduksi / dampak | Perbaikan |
| --- | --- | --- |
| Draf edit hilang saat hasil hitung tiba | Isi laki-laki `5` dan catatan, lalu kirim event kalkulasi untuk posko yang sama. Sebelumnya angka kembali `4` dan catatan kosong. | Form mengikuti identitas dan nilai sumber edit; perubahan object hasil hitung saja tidak mereset draf. |
| Posko baru dengan nama mirip menimpa tampilan posko lama | `Posko Harapan Baru` di Sukamaju digabung ke `Posko Harapan`, sehingga 3 baris menjadi 2. | Hilangkan pencocokan substring; gunakan nama yang dinormalisasi dan desa, atau target koreksi server yang pasti. |
| Koreksi nama/desa tidak konsisten antar lapisan | UI mempertahankan nama lama; validator sebelumnya menolak nama berbeda; pembandingan kandidat yang identitasnya berubah memakai label baru sehingga baseline lama dianggap usang. | UI mengikuti nama kandidat terikat; rename eksplisit dibaca dari sumber manusia immutable; baseline selalu memakai target asal. Penolakan perubahan bersamaan, tabrakan identitas dan konfirmasi simpan tetap berlaku. |
| Model berhenti setelah ekstraksi JSON | Pada rename live, model memanggil prepare lalu mencetak JSON tanpa validator; batch berakhir `needs_review`. | Runtime meneruskan records JSON ke validator MCP dengan SOURCE_REF operasi yang sama melalui gate izin. Tidak meneruskan persetujuan/sumber top-level model dan tidak pernah mengubahnya menjadi write. |

Rename melalui catatan memakai permintaan eksplisit, misalnya `Koreksi nama posko ini menjadi Posko Cibening Utama.` Nama yang tidak cocok dengan target/sumber tetap ditolak. Hasilnya tetap kandidat, bukan perubahan tersimpan.

## Skrip dan artefak

- `e2e/editEdgeCases.spec.ts`: tiga reproduksi UI; ketiganya gagal sebelum perbaikan dan lulus sesudahnya, desktop dan ponsel.
- `e2e/clarification.spec.ts`, `pendingReviews.spec.ts`, `villageCorrection.spec.ts`: angka invalid, 409, HTTP/SSE berlomba, dua desa, kandidat bergantian, dan cakupan persetujuan.
- `plugin/*.js`: macro eksplorasi plugin yang disimpan secara eksplisit. `verify-draft-preserved.js` memakai SSE terkontrol pada frontend Docker dan tidak mengirim pesan/simpan.
- `user-validation/edit-responses.spec.ts`: skenario live Harapan 98→102, Cibening 100→104, rename Cibening, perhitungan ulang, pemilihan kandidat, dan tampilan ponsel. Endpoint decisions diblokir di browser.
- `../../backend/tests/extractedValidation.test.ts`: pemulihan JSON dengan sumber/izin yang terikat serta tanpa write.
- `../../langflow/tests/test_sqlite_migration.py`: rename dari sumber, baseline identitas lama, penolakan nama tak terikat dan perubahan bersamaan.
- `../../backend/scripts/verify-rename-validator.ts --apply`: tes flow mandiri → MCP dengan rollback kode; tidak mengganti path SQLite atau menulis rekap. Salinan rollback konfigurasi ada di `output/`, jangan dibagikan karena dapat memuat kredensial.

Bukti gagal awal disimpan di `output/testing/edit-ui-audit/before-fixes/`. Screenshot plugin sesudah perbaikan: `output/testing/edit-ui-audit/plugin-draft-after.png`. Hasil suite browser mock: `frontend/test-results/results.json`; hasil live: `frontend/test-results-user-validation/results.json`.

## Verifikasi

- 78 tes browser mock desktop/ponsel lulus; 0 gagal, 0 flaky.
- 149 tes backend lulus, termasuk gerbang persetujuan dan source binding.
- 32 unit frontend dan 12 tes Python lulus; build frontend/backend berhasil.
- Flow validator mandiri dan MCP lulus tanpa write, dengan 8 record tersimpan tetap sama.
- Tes UI live lengkap lulus (sekitar 2 menit): dua kandidat tetap terpisah, rename berhasil, Harapan Sukamaju tetap 102 jiwa, Harapan Cipandan tetap 40, Cibening Utama 104 jiwa dengan kebutuhan air 1.560 L/hari. Tidak ada write. Screenshot desktop dan ponsel tersedia pada artefak hasil live.

Keterbatasan: tes ponsel menggunakan emulasi browser, bukan perangkat fisik. Tes live tidak menekan Konfirmasi persetujuan; penyimpanan sesungguhnya tidak dinyatakan lulus berdasarkan pratinjau. Refresh masih membuat sesi UI baru. Bukti otomatis ini bukan feedback peserta validasi pengguna.
