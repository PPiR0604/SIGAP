# Tes browser SIGAP

Dari `frontend`, jalankan `npm ci`, `npx playwright install chromium`, lalu `npm run test:e2e`. Konfigurasi default memakai frontend port 5183 dan backend mock port 8797 dengan repository SQLite memori; tes tidak membuktikan Supabase, model atau Langflow live.

Tes eksplisit di direktori ini mencakup laporan, OCR, clipboard gambar, persetujuan, klarifikasi, rekap, publikasi dan responsif. Misalnya `npm run test:e2e -- tests/e2e/documentOcr.spec.ts` menguji alur tinjau OCR dengan respons terkontrol. Proyek Chromium desktop dan emulasi mobile tidak menggantikan uji pada perangkat fisik.

Artefak tes berada di `playwright-report/` dan `test-results/`, keduanya diabaikan Git. Pengujian live terpisah dijelaskan di [../live/README.md](../live/README.md); jangan gunakan akun atau data produksi sebagai fixture.
