# Deploy MCP SIGAP ke Vercel

Tetap gunakan repository ini dan Supabase yang sudah ada. Buat **proyek Vercel khusus MCP**
dengan root `langflow`; frontend dan API backend tidak dimasukkan ke image MCP ini.
Tidak ada ketergantungan pada Render.

## Form Import Project

| Pengaturan | Nilai |
| --- | --- |
| Root Directory | `langflow` |
| Application Preset | **Container** |
| Build Command | Biarkan default; Dockerfile menangani build |
| Output Directory | Biarkan default |
| Install Command | Biarkan default |

`langflow/vercel.json` menetapkan `framework: container`; Vercel mendeteksi
`langflow/Dockerfile.vercel` sebagai entrypoint setelah root directory dipilih.
Jika form masih menampilkan **Other**, pastikan commit yang mengandung kedua file tersebut
sudah di-push lalu impor ulang/redeploy. Paket ini tidak memakai preset Next.js atau FastAPI.

Endpoint MCP setelah deploy: `https://<nama-proyek>.vercel.app/mcp`.
Health check: `https://<nama-proyek>.vercel.app/health`.
Domain publik hanya menyediakan dua route tersebut; editor dan API pengelolaan Langflow tersembunyi.

Container Runtime Vercel tersedia dalam beta. Konfigurasi repository memakai deteksi container
dan batas resource bawaan proyek, tanpa blok `functions`. Jangan menambahkan pola
`functions["Dockerfile.vercel"]`: CLI memeriksa pola tersebut sebagai source Serverless Function
dan menolaknya dengan `unused_function`.

Periksa durasi dan memori pada **Project Settings → Functions**; kebutuhan uji lokal paket ini
adalah 2 GB RAM dan anggaran request 300 detik. Nilai yang berlaku ditentukan oleh pengaturan
proyek dan plan Vercel. Pengaturan beta `maxConcurrency` tidak digunakan sehingga tidak
memerlukan `VERCEL_BETA_MAX_CONCURRENCY`. Tidak ada perubahan plan akun dari konfigurasi ini.
Batas dan ketersediaan fitur pada akun tetap diperiksa Vercel ketika deploy.

## Environment Variables

| KEY | VALUE |
| --- | --- |
| `PORT` | `10000` (juga ditetapkan di `vercel.json`) |
| `LANGFLOW_API_KEY` | Secret acak minimal 32 karakter untuk akses proxy MCP |
| `LANGFLOW_SECRET_KEY` | Secret acak berbeda, minimal 32 karakter |
| `LANGFLOW_SUPERUSER` | `sigap-mcp` |
| `LANGFLOW_SUPERUSER_PASSWORD` | Secret acak berbeda, minimal 16 karakter |
| `SIGAP_BACKEND_INTERNAL_URL` | Origin HTTPS API backend SIGAP, tanpa path atau slash tambahan |
| `SIGAP_LLM_BASE_URL` | Base URL HTTPS API kompatibel OpenAI, termasuk `/v1` jika diperlukan |
| `SIGAP_LLM_MODEL` | ID model ekstraksi yang tersedia di provider |
| `SIGAP_LLM_API_KEY` | API key provider model ekstraksi |

Template ada di `langflow/.env.example`. Nilai placeholder harus diganti. Untuk membuat satu
secret di terminal lokal, jalankan perintah berikut; ulangi tiga kali untuk tiga secret berbeda:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Simpan secret di environment Vercel dan backend yang memerlukannya. Jangan kirim password/API key
di chat atau commit ke Git. Key publik MCP diverifikasi proxy; key internal Langflow dibuat
terpisah saat startup dan tidak dikirim ke client.

Untuk demo gunakan akun/model nyata hanya setelah konfigurasinya lengkap. Keberhasilan build
atau `tools/list` tidak membuktikan ekstraksi model dan penyimpanan sudah berhasil.

## Backend autentikasi tetap diperlukan

`SIGAP_BACKEND_INTERNAL_URL` harus menunjuk ke **backend SIGAP yang dapat diakses melalui HTTPS**.
Backend tersebut boleh menjadi proyek Vercel terpisah. Memilih folder `langflow` hanya men-deploy
MCP; API backend tidak otomatis ikut berjalan. `localhost:8787` tidak dapat dipakai pada deployment.
Proxy akan gagal menjadi ready jika `/api/health` backend tidak dapat dijangkau.

Setiap tool tetap memerlukan capability bertanda tangan dari backend. Pemeriksaan pengguna,
sesi, role, konteks posko, dan persetujuan write tetap dilakukan oleh backend. Layanan MCP
tidak memerlukan service-role key Supabase. Konfigurasi backend tetap mengikuti
`backend/AUTH_SUPABASE.md`.

Setelah domain MCP tersedia, isi environment pada **backend**:

```dotenv
LANGFLOW_MCP_URL=https://<nama-proyek>.vercel.app/mcp
LANGFLOW_API_KEY=<nilai LANGFLOW_API_KEY pada proyek MCP>
SIGAP_MCP_ALLOWED_ORIGINS=https://<nama-proyek>.vercel.app
```

Gunakan domain Production yang tetap. Jangan menggunakan wildcard untuk allowlist atau
menyebarkan key ke preview yang tidak dipercaya. Jika Deployment Protection membatasi domain,
gunakan mekanisme akses mesin Vercel yang sesuai sebelum menjalankan probe.

## Penyesuaian untuk Function yang dapat scale to zero

- Proxy menggunakan MCP stateless. `initialize` dan `tools/call` dapat masuk ke instance yang
  berbeda. Setiap RPC membuat sesi privat Langflow sendiri dan menutupnya setelah selesai;
  `Mcp-Session-Id` internal tidak diberikan ke client. GET event stream tidak digunakan.
- Request pertama menunggu cold start, impor tujuh flow dan pemeriksaan backend. Startup
  dibatasi 150 detik; eksekusi satu RPC dibatasi 120 detik. Client backend memberi waktu hingga
  280 detik untuk endpoint HTTPS. Seluruh operasi aplikasi tetap punya batas waktunya sendiri.
- Database kontrol Langflow berada di `/tmp` dan dapat dibuat ulang. Jangan menyimpan data posko
  atau mengedit flow permanen di instance Function. Data aplikasi tetap di Supabase melalui backend.
- Tidak ada retry otomatis `tools/call`. Jika write timeout, hasilnya belum tentu gagal;
  baca kembali status melalui backend sebelum mencoba lagi. Gerbang persetujuan dan receipt
  idempotensi tetap berlaku.
- Filesystem image vendor dipaketkan ulang ke 16 layer dengan batas ukuran masing-masing.
  Ini menghindari satu layer dependency Langflow yang melebihi batas 500 MB VCR, tanpa mengganti
  Python, library OS, versi Langflow, atau tujuh komponen eksekusinya.
- Launcher menangani shutdown agar proses Langflow berhenti dalam jendela SIGTERM Vercel.

## Pemeriksaan setelah deploy

1. `/health` harus mengembalikan HTTP 200 dengan `status: ok` setelah cold start.
2. `/mcp` tanpa `x-api-key` harus ditolak HTTP 401.
3. `/api/v1/flows/`, `/docs` dan `/openapi.json` harus HTTP 404.
4. Jalankan probe dari folder `backend`, menggunakan environment yang sudah diisi:

```powershell
node --import tsx --env-file=../.env scripts/probe-mcp-deployment.ts https://<nama-proyek>.vercel.app/mcp
```

Probe memeriksa daftar tujuh tool dan penolakan eksekusi tanpa capability. Probe tidak login
atau menulis data posko. Pengujian pengguna nyata dilakukan bertahap: login, baca sesuai scope,
preview, persetujuan petugas, lalu write dan read-back.

## Validasi lokal

- `vercel.json` lulus validasi terhadap skema resmi Vercel. Image Docker berhasil dibangun;
  pemaketan vendor menghasilkan 16 layer dengan payload terbesar sekitar 162 MiB.
- Uji container dengan batas 1 CPU dan 2 GB RAM berhasil: health check, tujuh tool, kewajiban
  API key, API pengelolaan yang tersembunyi, dan penolakan eksekusi tanpa capability.
- Client MCP yang sama berhasil memanggil tool setelah seluruh container dan database kontrol
  ephemeral diganti, tanpa mengulangi `initialize` pada client publik. Pengujian unit juga
  memeriksa pergantian replica, cleanup sesi, timeout write tanpa replay, dan SSE yang tetap terbuka.
- 30 pengujian Python dan build TypeScript lulus. Regresi backend dijalankan; satu tes startup
  melewati batas lima detik saat build image membebani mesin, lalu lulus ketika dijalankan ulang.

Callback health sintetis dipakai untuk mengisolasi uji container. Deployment Vercel, callback
ke backend nyata, login pengguna, panggilan model, dan write Supabase belum diuji end-to-end.
URL HTTPS backend harus tersedia sebelum layanan MCP dapat digunakan pada deployment sebenarnya.

Referensi resmi: [Docker pada Vercel](https://vercel.com/kb/guide/docker),
[Container Registry dan batas layer](https://vercel.com/kb/guide/how-to-use-vercel-container-registry),
[batas Functions](https://vercel.com/docs/functions/limitations),
[skema vercel.json](https://openapi.vercel.sh/vercel.json).
