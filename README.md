# SIGAP — Sistem Intelijen Logistik dan Asisten Posko

SIGAP membantu petugas pos komando mengubah laporan lapangan (chat WhatsApp, unggahan CSV, hingga dokumen fisik/OCR) menjadi data terstruktur, memeriksa kelengkapan serta konfliknya, menghitung acuan kebutuhan dasar berbasis standar kemanusiaan Sphere 2018, dan menyusun buletin logistik. Proyek ini ditujukan untuk relawan, petugas pendataan, koordinator logistik, dan pimpinan pos komando.

AI membantu pemahaman maksud pesan, ekstraksi informasi, dan pemilihan tool. Validasi, perhitungan numerik, otorisasi, dan persetujuan penyimpanan tetap dijalankan secara deterministik dan diperiksa oleh sistem (**Human-in-the-Loop**). Keputusan distribusi bantuan sepenuhnya berada pada petugas dan pihak berwenang.

---

## Panduan Cepat

| Tujuan | Panduan |
| :--- | :--- |
| Setup Docker + Supabase lokal (satu perintah) | [Setup Docker dan Supabase lokal](deployment/local/README.md) |
| Konfigurasi layanan Backend & API | [Dokumentasi Backend](backend/README.md) |
| Antarmuka Web, BoardUI & Mode Offline | [Dokumentasi Frontend](frontend/README.md) |
| Konfigurasi 7 Flow MCP Langflow & Sphere | [Dokumentasi Langflow](langflow/README.md) |

---

## 1. Menjalankan Demo Lokal (Docker + Supabase Lokal)

Siapkan Docker Desktop atau Docker Engine dengan Compose, koneksi internet untuk setup awal dan panggilan model AI, serta kredensial provider model (seperti IBM watsonx.ai atau endpoint OpenAI-compatible). Jalankan dari root repositori:

**Windows PowerShell:**
```powershell
.\start-sigap.ps1
```

**Linux / macOS:**
```bash
bash ./start-sigap.sh
```

Installer akan menyiapkan seluruh stack secara otomatis (PostgreSQL/Supabase lokal, GoTrue Auth, PostgREST, Edge Gateway, Mailpit, Backend Fastify, Frontend React, dan Langflow), akun latihan di `.sigap-local-accounts.txt`, serta 8 data posko sintetis awal (630 jiwa).

Setelah verifikasi selesai, akses antarmuka di **`http://localhost:8080`**.

Perintah manajemen stack lokal:
```powershell
.\start-sigap.ps1 status   # Cek status seluruh container
.\start-sigap.ps1 verify   # Verifikasi koneksi dan skema lokal
.\start-sigap.ps1 stop     # Hentikan container (data tetap tersimpan)
.\start-sigap.ps1 reset -ConfirmLocalReset  # Reset data lokal
```

Lihat [panduan setup lokal lengkap](deployment/local/README.md) untuk opsi pergantian provider AI, port layanan, dan pemecahan masalah.

---

## 2. Fitur Utama

| Fitur | Deskripsi |
| :--- | :--- |
| **Tugas** | Mendeteksi data posko yang perlu diperiksa, diverifikasi, atau dilengkapi oleh petugas. |
| **Laporan & OCR** | Input percakapan, impor TXT/CSV (maks. 200 KiB), serta pemindaian OCR dokumen PDF/JPG/PNG (maks. 5 MiB, PDF maks. 5 halaman) dengan peninjauan teks sebelum diproses AI. |
| **Klarifikasi & Konflik** | Memeriksa sumber asli, mengoreksi angka secara terstruktur, membandingkan kandidat dengan nilai tersimpan, serta menangani data kosong/inkonsisten. |
| **Kalkulasi Sphere 2018** | Perhitungan deterministik acuan kebutuhan air (15 L/jiwa/hari), energi pangan (2.100 kkal/jiwa/hari), jamban, ruang hunian, dan rincian kelompok usia di Langflow; lihat [asumsi dan batasan Sphere](langflow/SPHERE_PLANNING.md). |
| **Rekap & Analisis Chat** | Pencarian posko, filter kebutuhan, detail per posko, ekspor CSV, serta tool baca-saja `analyze_shelter_needs` untuk analisis peringkat kebutuhan langsung dari hasil kalkulator. |
| **Persetujuan & Read-Back** | Penulisan ke database wajib melalui persetujuan eksplisit petugas di UI terikat hash snapshot SHA-256 dan diverifikasi melalui baca ulang (*read-back*). |
| **Buletin & Tautan Publik** | Penyusunan draf buletin kebutuhan berbasis rekap tervalidasi serta penerbitan tautan publik statis bertoken dengan persetujuan admin. |
| **Mode Offline (PWA)** | Penyimpanan draf laporan dan salinan rekap di perangkat (`IndexedDB` + *Service Worker*) saat koneksi terputus, untuk dikirim ulang secara manual ketika online. |

---

## 3. Arsitektur Sistem

```text
Petugas -> Web React (BoardUI) -> Backend Fastify -> AI Model memilih tool
                                       │                    │
                                       │ <──────────────────+
                                       ├─> MCP (uvx/HTTP) -> Langflow (7 Flow Modular)
                                       ├─> Supabase Auth + Gateway HMAC -> PostgreSQL + RLS
                                       └─> Validasi snapshot, persetujuan HITL, & read-back
```

### Pembagian Peran Komponen
- **Web React (`frontend/`)**: Antarmuka workspace (*Tugas → Laporan → Rekap → Buletin*), komponen BoardUI, tinjauan OCR, klarifikasi berdampingan, mode offline (`IndexedDB`), dan buletin publik.
- **Backend Fastify (`backend/`)**: Manajemen sesi, otorisasi peran (`admin`, `petugas`, `viewer`), penyaringan data pribadi otomatis (*PII redaction*), orkestrasi SSE *real-time*, tool analisis baca-saja [`analyze_shelter_needs`](backend/src/pipeline/analysisTool.ts), dan gerbang persetujuan penulisan.
- **Langflow MCP Engine (`langflow/`)**: Menjalankan 7 flow modular (`fetch_shelters`, `prepare_needs`, `validate_needs`, `calculate_gap`, `flag_anomalies`, `upsert_shelter`, `draft_bulletin`) melalui MCP (`sigap_0_fetch_shelters` s/d `sigap_6_draft_bulletin`).
- **Provider Model AI**: Mendukung runtime **IBM watsonx.ai**, endpoint lokal **OpenAI-compatible**, **Google Gemini**, serta adapter **IBM Bob** (MCP/ACP).

---

## 4. Pengembangan & Pengujian (Tanpa Docker Lokal)

Untuk pengembangan native atau deployment cloud menggunakan `.env` root (lihat [`.env.example`](.env.example)), [panduan Supabase](backend/AUTH_SUPABASE.md), dan [ruang operasi](backend/COMMAND_WORKSPACES.md).

**Persyaratan**: Node.js 22+ dan Python 3.10+.

```powershell
# 1. Backend Fastify: build & unit/integration tests
cd backend
npm ci
npm run build
npm test

# 2. Frontend React: build (termasuk offline shell), unit tests, & E2E Playwright
cd ../frontend
npm ci
npm run build
npm test
npx playwright install chromium
npm run test:e2e

# Uji mode offline setelah build
npx playwright test --config playwright.offline.config.ts

# 3. Pengujian komponen Python Langflow
cd ..
python -m pytest langflow/tests -q
```

Untuk panduan testing lebih rinci, lihat [panduan E2E browser](frontend/tests/e2e/README.md) dan [panduan uji live](frontend/tests/live/README.md).

---

## 5. Struktur Direktori

```text
├── .env.example             # Template konfigurasi tunggal (cloud & model)
├── docker-compose.yml       # Orkestrasi deployment mode cloud
├── docker-compose.local.yml # Orkestrasi stack lengkap + Supabase lokal
├── start-sigap.ps1          # Skrip runner one-click Windows PowerShell
├── start-sigap.sh           # Skrip runner one-click Linux/macOS
├── backend/                 # Layanan backend Fastify, Auth, OCR, Supabase & MCP client
├── frontend/                # Web Workspace React + Vite + BoardUI + Mode Offline
├── langflow/                # 7 Flow MCP Langflow (Supabase & SQLite), komponen & deployment Vercel
├── deployment/local/        # Setup otomatis Supabase lokal, gateway Nginx, skema & seed data
├── mcp/                     # Konfigurasi & instruksi agen MCP (Bob / Gemini / OpenAI)
├── integrations/            # Skrip webhook Google Apps Script (Sheets & Docs)
├── data/                    # Dataset sintetis, paket uji pengguna, sampel OCR & studi banding manual
├── dokumentasi-proyek/      # Tangkapan layar aplikasi dan integrasi
└── output/                  # Folder keluaran lokal (diabaikan Git)
```

---

## 6. Keamanan Data

Simpan API key, kata sandi database, secret gateway HMAC, token, dan file `.env` / `.env.sigap-local` / `.sigap-local-accounts.txt` di luar Git. Jangan mengirim secret gateway ke frontend atau model AI. Gunakan data sintetis di [`data/synthetic/`](data/synthetic/) untuk pengujian atau demonstrasi publik.
