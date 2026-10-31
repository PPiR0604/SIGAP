# Backend SIGAP

Backend Fastify/TypeScript menghubungkan antarmuka, Supabase Auth, gateway data, model, dan tool Langflow melalui MCP. Konfigurasi utama berasal dari `.env` root; gunakan `.env.example` sebagai template tanpa kredensial.

## Arsitektur dan keamanan

Produksi menggunakan Supabase untuk autentikasi dan data operasional. Role dan penugasan diperiksa server; `admin` mengelola akses dan publikasi, `petugas` bekerja di operasi yang ditugaskan, dan `viewer` membaca publikasi yang disetujui. Tautan publik buletin dapat dibaca tanpa login. Akses ini tidak memberi akses ke chat atau data mentah.

Backend menyaring pola PII sebelum input model, mengikat persetujuan ke kandidat/snapshot dan keputusan konflik, serta memverifikasi hasil dengan pembacaan ulang. Jika status simpan belum pasti, periksa rekap sebelum mencoba lagi. Hasil hitung berasal dari Langflow; backend mengirim referensi snapshot dan memverifikasi cakupan hasil.

Backend menerbitkan capability singkat untuk flow Supabase dan gateway memakai autentikasi HMAC. Secret gateway dan service key harus tetap di server; jangan gunakan `VITE_*` atau commit kredensial. Periksa [panduan Supabase](AUTH_SUPABASE.md) dan [ruang operasi](COMMAND_WORKSPACES.md) untuk langkah provisioning dan batas akses. Adapter Bob belum mendukung capability Supabase dan fail-closed pada jalur ini.

## Konfigurasi dan menjalankan

Isi `SIGAP_SUPABASE_URL`, `SIGAP_SUPABASE_PUBLISHABLE_KEY`, `SIGAP_SUPABASE_GATEWAY_SECRET`, `SIGAP_ORGANIZATION_ID`, URL/key MCP dan konfigurasi model pada `.env` root. Untuk OpenAI-compatible gunakan `SIGAP_AGENT_PROVIDER=openai`, `SIGAP_OPENAI_BASE_URL`, `SIGAP_OPENAI_MODEL`, dan key; untuk Gemini pilih `gemini` dan isi konfigurasi Gemini. Jangan menganggap model di contoh tersedia di setiap provider.

```powershell
# Dari root
 docker compose up -d --build
# Pengembangan native
 cd backend
 npm ci
 npm start
```

Backend Docker dipublikasikan pada port 8787. Langflow di host perlu dapat mengakses backend melalui `SIGAP_BACKEND_INTERNAL_URL`. Setelah mengubah `.env`, buat ulang container backend agar environment dibaca ulang. Registrasi memakai password minimal 8 karakter; respons menentukan apakah ruang latihan siap atau akses masih pending. Registrasi tanpa email mengharuskan Confirm email dimatikan di Supabase.

## Pengujian

```powershell
npm run build
npm test
```

Fixture SQLite memori dan mock tidak menggantikan tes Supabase atau Langflow nyata. Uji baca rekap, kalkulasi, koreksi, persetujuan, write/read-back, akses role dan publikasi di lingkungan terisolasi. Probe MCP dapat dijalankan dengan `npm run probe:mcp`; jangan menyimpan kredensial dalam output tes.

## API utama

`/api/auth/*` menangani sesi Auth; `/api/sessions` serta endpoint pesan dan SSE menangani operasi; endpoint `overview` memuat rekap dan kalkulasi; `/api/sessions/:id/documents/extract` membaca dokumen untuk tinjauan OCR. Persetujuan kandidat dan publikasi adalah langkah terpisah. Gunakan kode route sebagai sumber kontrak terkini; perubahan operasional memerlukan autentikasi dan otorisasi, sedangkan tautan publik hanya menyajikan publikasi yang telah disetujui.
