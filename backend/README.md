# Backend SIGAP

Backend Fastify/TypeScript menghubungkan antarmuka, Supabase Auth, gateway data, model, dan tool Langflow melalui MCP. Untuk demo satu komputer, gunakan [paket lokal](../deployment/local/README.md). Pengembangan native dan Docker cloud memakai `.env` root; Docker lokal memakai `.env.sigap-local`.

## Arsitektur dan keamanan

Produksi menggunakan Supabase untuk autentikasi dan data operasional. Role dan penugasan diperiksa server; `admin` mengelola akses dan publikasi, `petugas` bekerja di operasi yang ditugaskan, dan `viewer` membaca publikasi yang disetujui. Tautan publik buletin dapat dibaca tanpa login. Akses ini tidak memberi akses ke chat atau data mentah.

Backend menyaring pola PII sebelum input model, mengikat persetujuan ke kandidat/snapshot dan keputusan konflik, serta memverifikasi hasil dengan pembacaan ulang. Jika status simpan belum pasti, periksa rekap sebelum mencoba lagi. Hasil hitung berasal dari Langflow; backend mengirim referensi snapshot dan memverifikasi cakupan hasil.

Backend menerbitkan capability singkat untuk flow Supabase dan gateway memakai autentikasi HMAC. Secret gateway dan service key harus tetap di server; jangan gunakan `VITE_*` atau commit kredensial. Periksa [panduan Supabase](AUTH_SUPABASE.md) dan [ruang operasi](COMMAND_WORKSPACES.md) untuk langkah provisioning dan batas akses. Adapter Bob belum mendukung capability Supabase dan fail-closed pada jalur ini.

## Konfigurasi dan menjalankan

Untuk pengembangan native/cloud, isi `SIGAP_SUPABASE_URL`, `SIGAP_SUPABASE_PUBLISHABLE_KEY`, `SIGAP_SUPABASE_GATEWAY_SECRET`, `SIGAP_ORGANIZATION_ID`, URL/key MCP, dan konfigurasi model pada `.env` root. Jangan menganggap model di template tersedia di setiap provider.

| Provider | Konfigurasi |
| --- | --- |
| `watsonx` | `SIGAP_WATSONX_URL`, `SIGAP_WATSONX_PROJECT_ID`, `SIGAP_WATSONX_API_KEY`, `SIGAP_WATSONX_MODEL` |
| `openai` | `SIGAP_OPENAI_BASE_URL`, `SIGAP_OPENAI_MODEL`, `SIGAP_OPENAI_API_KEY`; endpoint kompatibel OpenAI yang dibatasi ke host lokal oleh kode |
| `gemini` | `GEMINI_API_KEY`, `GEMINI_MODEL`, dan batas kuota bila diperlukan |
| `bob` | Konfigurasi ACP/MCP; jalur Supabase adapter backend tetap fail-closed |
| `mock` | Fixture pengujian; bukan pengganti runtime produksi |

Pilih dengan `SIGAP_AGENT_PROVIDER`. Dukungan runtime tidak berarti semua variabel provider diteruskan setiap file Compose; paket lokal saat ini menyediakan watsonx dan OpenAI-compatible. Periksa file Compose yang dipakai.

```powershell
# Cloud yang sudah diprovisioning, dari root
docker compose up -d --build
# Pengembangan native, dari root
cd backend
npm ci
npm start
```

Backend native dan Compose cloud memakai port 8787. Pada paket lokal, backend diakses melalui proxy frontend port 8080 dan jaringan internal Docker. Langflow di host perlu dapat mengakses backend melalui `SIGAP_BACKEND_INTERNAL_URL`. Setelah mengubah environment, buat ulang container backend agar nilainya dibaca ulang. Registrasi memakai password minimal 8 karakter; respons menentukan apakah ruang latihan siap atau akses masih pending. Registrasi tanpa email mengharuskan Confirm email dimatikan di Supabase; ini pilihan deployment, bukan ketentuan untuk semua instalasi.

## Pemilihan tool dan hasil analisis

Pesan teks biasa dipahami model sebelum memilih tool. Backend tidak memakai daftar kata tanya untuk memaksa pesan menjadi laporan. Tool `analyze_shelter_needs` pada [analysisTool.ts](src/pipeline/analysisTool.ts) mengomposisi pembacaan dan kalkulasi Langflow dengan parameter `view` serta `scope` yang tervalidasi. Ini bukan flow baru atau pengganti tujuh flow modular.

Analisis seluruh kebutuhan, ranking air, dan prioritas umum disajikan dari hasil kalkulator yang telah diperiksa. Model tidak menyusun ulang angka pada langkah akhir tool ini. Akses tetap melewati pemeriksaan sesi dan penugasan. Hasil dengan referensi, cakupan, atau identitas yang tidak sesuai dihentikan.

Laporan teks memakai pemilihan tool model. Impor CSV, formulir terstruktur, dan koreksi bertarget mempertahankan jalur validasi khusus. Writer tetap dibatasi pada kelanjutan persetujuan server. Publikasi buletin memiliki persetujuan tersendiri.

## Pengujian

```powershell
npm run build
npm test
```

Fixture SQLite memori dan mock tidak menggantikan tes Supabase atau Langflow nyata. Uji baca rekap, kalkulasi, koreksi, persetujuan, write/read-back, akses role dan publikasi di lingkungan terisolasi. Probe MCP dapat dijalankan dengan `npm run probe:mcp`; jangan menyimpan kredensial dalam output tes.

## API utama

`/api/auth/*` menangani sesi Auth; `/api/sessions` serta endpoint pesan dan SSE menangani operasi; endpoint `overview` memuat rekap dan kalkulasi; `/api/sessions/:id/documents/extract` membaca dokumen untuk tinjauan OCR. Persetujuan kandidat dan publikasi adalah langkah terpisah. Gunakan kode route sebagai sumber kontrak terkini; perubahan operasional memerlukan autentikasi dan otorisasi, sedangkan tautan publik hanya menyajikan publikasi yang telah disetujui.
