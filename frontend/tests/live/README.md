# Pengujian Langflow nyata

`npm run test:e2e:live` menjalankan konfigurasi Playwright terpisah, dengan layanan dan provider nyata yang dikonfigurasi lingkungan. Periksa `playwright.live.config.ts` dan `start-backend.ts` sebelum menjalankannya: fixture backend menggunakan repository memori dan konfigurasi uji; provider dipilih dari environment. Tes dapat memakai kuota model dan menghubungi Langflow yang dikonfigurasi. Gunakan hanya data sintetis dan lingkungan yang diizinkan.

Hasil tes lama tidak membuktikan deployment saat ini. Uji flow Playground, MCP, runtime dan aplikasi secara terpisah; verifikasi juga akses Supabase dan penyimpanan dalam lingkungan terisolasi. Hasil HTML dan artefak live berada di `playwright-report-live/` dan `test-results-live/`.
