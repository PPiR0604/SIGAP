# SIGAP (Sistem Informasi dan Manajemen Logistik Tanggap Bencana)

Sistem Intelijen Logistik dan Asisten Posko yang mengintegrasikan antarmuka percakapan **IBM Bob** dan **Web Workspace** dengan **Langflow** (sebagai *Execution Engine*) melalui **Model Context Protocol (MCP)**. SIGAP membantu petugas Pos Komando mengubah teks laporan WhatsApp bencana menjadi rekap pengungsi terpilah, memeriksa anomali data, menghitung kalkulasi kebutuhan dasar standar Sphere, serta menyusun draf buletin logistik untuk donatur dengan prinsip **Human-in-the-Loop (HITL)**.

```text
[Petugas Posko] ↔ [Web Workspace / IBM Bob] ↔ [Backend SIGAP / MCP] ↔ [Langflow] ↔ [CSV / Google Workspace]
```

---

## 1. Fitur Utama & Keunggulan

- **Input Percakapan Lapangan**: Menerima salinan teks atau berkas `.txt` ekspor chat WhatsApp posko lapangan secara langsung.
- **Penyaringan Data Pribadi Otomatis (PII Redaction)**: NIK (16 digit), nomor telepon, nomor rekening, dan email disamarkan secara otomatis sebelum teks dikirim ke model AI.
- **Validasi Data & Deteksi Anomali**: Mendeteksi ketidakkonsistenan angka pengungsi, kelompok rentan (balita, lansia, bumil), laporan duplikat, dan posko yang belum memperbarui data (>24 jam).
- **Kalkulasi Standar Kemanusiaan (Sphere Project)**: Menghitung estimasi kebutuhan dasar darurat (air 15 L/orang/hari, pangan 2.100 kkal, perlengkapan bayi, sanitasi) secara deterministik menggunakan rumus tetap.
- **Persetujuan Manusia Interaktif (Human-in-the-Loop / HITL)**: Penulisan data ke penyimpanan hanya dapat dieksekusi setelah mendapatkan persetujuan eksplisit dari petugas melalui modal persetujuan Web Workspace atau instruksi Bob.
- **Verifikasi Dua Arah (*Read-Back Verification*)**: Setelah data disimpan, sistem membaca kembali (*read-back*) data tersimpan untuk mencocokkan checksum/hash guna menjamin keaslian data.
- **Draf Buletin Donatur**: Menyusun ringkasan publikasi donatur secara otomatis untuk memudahkan koordinasi bantuan relawan dan pihak berwenang.

---

## 2. Pengaturan Konfigurasi (Satu File `.env`)

Semua konfigurasi sistem disatukan ke dalam **satu berkas `.env`** di root repositori:

Salin template `.env.example` menjadi `.env`:

```bash
cp .env.example .env
```

### Parameter yang Tersedia di `.env`:

| Variabel | Pilihan / Contoh | Penjelasan |
| :--- | :--- | :--- |
| `SIGAP_AGENT_PROVIDER` | `gemini` (default) \| `mock` \| `bob` | Runtime agen yang digunakan. `gemini` untuk live Gemini API, `mock` untuk simulasi lokal tanpa API/kuota, `bob` untuk IBM Bob ACP. |
| `GEMINI_API_KEY` | `AIzaSy...` | API Key Google Gemini (jika menggunakan provider `gemini`). |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` \| `gemini-3.8-flash` | Model Gemini yang digunakan untuk ekstraksi & percakapan. |
| `LANGFLOW_MCP_URL` | `http://localhost:7860/api/v1/mcp/project/<PROJECT_ID>/streamable` | Endpoint MCP Streamable HTTP dari project Langflow Anda. |
| `LANGFLOW_API_KEY` | `sk-...` | API Key dari Langflow untuk mengakses tool MCP. |
| `SIGAP_SESSION_TOKEN` | *(Biarkan kosong)* | Token keamanan sesi lokal. Dibiarkan kosong agar otomatis dibuat dan disinkronkan ke frontend tanpa input manual. |

> **Mode Simulasi Cepat**: Jika kuota API habis atau ingin menguji antarmuka tanpa API eksternal, cukup setel `SIGAP_AGENT_PROVIDER=mock`.

---

## 3. Menyiapkan Langflow (Execution Engine)

Langflow berfungsi sebagai **Execution Engine** yang menjalankan 7 flow modular (setiap flow bertindak sebagai tool MCP).

### Langkah 1: Jalankan Langflow Desktop
Pastikan Langflow Desktop aktif di komputer Anda:
- Akses UI Langflow di: **`http://localhost:7860`**

### Langkah 2: Import 7 Flow JSON
1. Di Langflow, klik tombol **New Project** atau buat project baru (beri nama, misalnya **`SIGAP`**).
2. Klik tombol **Upload / Import** di dalam project tersebut.
3. Import ketujuh file flow JSON yang berada di folder [`langflow/flows/`](langflow/flows/):
   - `fetch_shelters.json` → Tool membaca rekap posko tersimpan.
   - `prepare_needs.json` → Tool masking PII & ekstraksi laporan ke format terstruktur.
   - `validate_needs.json` → Tool validasi relasi angka, field kosong, dan integritas data.
   - `calculate_gap.json` → Tool kalkulasi gap kebutuhan air (15 L/org/hari), pangan (2.100 kkal), sanitasi & hunian.
   - `flag_anomalies.json` → Tool deteksi laporan duplikat & posko senyap (>24 jam).
   - `upsert_shelter.json` → Tool penyimpanan data terverifikasi (memerlukan persetujuan petugas / HITL).
   - `draft_bulletin.json` → Tool penyusunan draf buletin donatur.

### Langkah 3: Pengaturan Input pada Node di Langflow
Buka flow dan sesuaikan input berikut sesuai kebutuhan:

1. **Pada flow `prepare_needs` (Ekstraksi LLM)**:
   - Klik node **OpenAI Report Extractor**.
   - Masukkan **API Key** model LLM ekstraksi Anda.
   - Masukkan **Base URL** (misalnya `https://api.openai.com/v1` atau endpoint provider kompatibel OpenAI lainnya) dan **Model Name**.
   *(Catatan: Jika memakai backend SIGAP dengan Gemini, ekstraksi laporan ditangani langsung oleh runtime backend).*

2. **Pada flow `fetch_shelters` & `upsert_shelter` (Penyimpanan Data)**:
   - **Mode CSV Lokal (Default)**: Biarkan input file path mengarah ke `output/rekap_posko.csv`. Data akan disimpan dan dibaca secara lokal.
   - **Mode Google Sheets (Opsional)**:
     - Jika ingin terhubung ke Google Sheets, deploy skrip [`integrations/google_apps_script/Code.gs`](integrations/google_apps_script/Code.gs) sebagai Web App di Google Apps Script.
     - Masukkan **Webhook URL** dan **Shared Secret** pada node *Logistics Storage Reader* (`fetch_shelters`) dan *Logistics Storage Writer* (`upsert_shelter`).

3. **Pada flow `draft_bulletin` (Google Docs - Opsional)**:
   - Masukkan Webhook URL Google Apps Script jika ingin mengaktifkan pembuatan Google Docs otomatis (hanya dieksekusi setelah persetujuan eksplisit petugas).

### Langkah 4: Mengambil Kredensial MCP Langflow
1. Masuk ke project SIGAP di Langflow, klik tab **MCP Server**.
2. Pastikan ketujuh tool (`sigap_0_fetch_shelters` s/d `sigap_6_draft_bulletin`) dalam status **Enabled / Aktif**.
3. Buat API Key Langflow: Klik **Settings** (ikon gear di pojok kanan atas) → **API Keys** → **Create New Key**, lalu salin kuncinya.
4. Salin URL endpoint Streamable HTTP dari tab MCP Server (format: `http://localhost:7860/api/v1/mcp/project/<PROJECT_ID>/streamable`).
5. Tempelkan URL dan API Key tersebut ke file [`.env`](.env) Anda pada variabel `LANGFLOW_MCP_URL` dan `LANGFLOW_API_KEY`.

---

## 4. Pilihan Cara Menjalankan Projek

### Opsi A: Menjalankan dengan Docker Compose (Direkomendasikan)

Frontend (React + Nginx) dan Backend (Fastify Node 22) dijalankan secara bersamaan dalam container Docker:

```bash
docker compose up --build
```

- **Frontend**: Akses di **`http://localhost:5173`** atau **`http://localhost`**.
- **Backend API**: Berjalan di **`http://localhost:8787`** (di-reverse proxy otomatis oleh Nginx).
- **Auto-Sync Token**: Frontend langsung tersinkronisasi dengan backend tanpa perlu memasukkan token sesi manual.
- **Koneksi ke Langflow**: Backend di dalam Docker otomatis mengarahkan `localhost:7860` ke `host.docker.internal:7860` sehingga langsung terhubung ke Langflow yang aktif di komputer host Anda.

Untuk menghentikan container:
```bash
docker compose down
```

---

### Opsi B: Menjalankan Secara Lokal (Tanpa Docker)

Jika Anda ingin menjalankan frontend dan backend langsung di Node.js host:

#### 1. Jalankan Backend:
```powershell
cd backend
npm install
npm start
```
*Backend akan berjalan di `http://127.0.0.1:8787` dan membaca konfigurasi dari `.env`.*

#### 2. Jalankan Frontend (di terminal baru):
```powershell
cd frontend
npm install
npm run dev
```
*Buka browser di `http://127.0.0.1:5173`. Status koneksi akan langsung hijau (Ready) dan token sesi otomatis tersinkronisasi.*

---

### Opsi C: Menjalankan di IBM Bob (Tanpa Docker — Sesuai Standar Percakapan Bob)

Sistem menggunakan **IBM Bob sebagai User-Facing Conversation Agent** yang terhubung langsung ke **Langflow MCP Server**:

```text
[User] <--> [IBM Bob (MCP Client)] <--(MCP via uvx)--> [Langflow (MCP Server)]
```

#### Langkah Menghubungkan IBM Bob ke Langflow MCP:

1. **Pastikan Prasyarat Tersedia**:
   - Python 3.10+ dan `uv` terinstal di komputer Anda (`pip install uv`).
   - Langflow Desktop berjalan di `http://localhost:7860` dengan project SIGAP aktif.

2. **Konfigurasi MCP Bob**:
   Buka berkas [`mcp/bob_mcp_config.json`](mcp/bob_mcp_config.json). Konfigurasi menggunakan bridge resmi `uvx --with "mcp<2.0.0>" mcp-proxy`:
   ```json
   {
     "mcpServers": {
       "sigap": {
         "command": "cmd",
         "args": [
           "/c",
           "uvx",
           "--with",
           "mcp<2.0.0>",
           "mcp-proxy",
           "--headers",
           "x-api-key",
           "<LANGFLOW_API_KEY>",
           "--transport",
           "streamablehttp",
           "http://localhost:7860/api/v1/mcp/project/<PROJECT_ID>/streamable"
         ]
       }
     }
   }
   ```
   *Ganti `<LANGFLOW_API_KEY>` dan `<PROJECT_ID>` dengan kredensial Langflow Anda.*

3. **Daftarkan MCP Server di IBM Bob**:
   - Pada aplikasi IBM Bob (Bob Desktop / Bob Shell CLI), tambahkan MCP Server menggunakan konfigurasi JSON di atas.
   - Verifikasi bahwa ketujuh tool SIGAP (`fetch_shelters`, `prepare_needs`, `validate_needs`, `calculate_gap`, `flag_anomalies`, `upsert_shelter`, `draft_bulletin`) terdeteksi di Bob.

4. **Setel System Prompt / Instruksi Bob**:
   Salin seluruh isi instruksi dari berkas [**`mcp/bob_agent_instructions.md`**](mcp/bob_agent_instructions.md) dan masukkan sebagai *System Prompt / Agent Instructions* pada IBM Bob.
   Instruksi ini mengatur:
   - Alur Outside-In: baca rekap tersimpan (`fetch_shelters`), ekstraksi & validasi (`prepare_needs`), deteksi anomali (`flag_anomalies`).
   - Penegakan **Human-in-the-Loop**: Bob dilarang melakukan aksi simpan (`upsert_shelter`) sebelum petugas menyetujui pratinjau snapshot, hash integritas, dan keputusan pembersihan field (`clear / keep / defer`).
   - Kalkulasi kebutuhan dasar Sphere dan draf buletin.

5. **Mulai Percakapan di Bob**:
   Buka chat IBM Bob dan tempelkan contoh laporan lapangan WhatsApp (misal dari berkas [`data/sample_wa_export.txt`](data/sample_wa_export.txt)). Bob akan memanggil tool Langflow secara bertahap dan memandu proses hingga selesai.

---

## 5. Struktur Direktori Proyek

```text
├── .env.example        # Template variabel lingkungan
├── docker-compose.yml  # Orkestrasi container frontend & backend
├── backend/            # Fastify, SQLite, runtime Gemini/MCP, adapter Bob ACP
│   ├── Dockerfile
│   ├── src/
│   ├── scripts/        # Skrip pengujian smoke & MCP probe
│   └── tests/          # Suite pengujian unit & integrasi backend
├── frontend/           # React + Vite Workspace untuk operator posko
│   ├── Dockerfile
│   ├── nginx.conf      # Reverse proxy API & streaming SSE
│   ├── src/
│   └── tests/          # Suite pengujian frontend
├── langflow/           # Asset eksekusi Langflow
│   ├── flows/          # 7 file flow JSON untuk di-import ke Langflow
│   ├── components/     # Kode Python custom components
│   └── prompts/        # Template prompt ekstraksi
├── mcp/                # Konfigurasi MCP dan instruksi prompt Bob/Gemini
├── integrations/       # Skrip Google Apps Script (Sheets & Docs)
├── data/               # Contoh data teks laporan bencana dan dataset evaluasi
├── dokumentasi-proyek/ # Tangkapan layar antarmuka Web UI, Bob, Langflow, dan Sheets
└── output/             # Direktori output file CSV hasil penyimpanan
```

---

## 6. Pengujian & Verifikasi (Testing)

Jalankan suite pengujian untuk memvalidasi integritas logika, kontrak data, dan keandalan sistem:

```powershell
# 1. Jalankan pengujian backend Fastify (127 pengujian)
cd backend
npm test

# 2. Jalankan pengujian frontend React (18 pengujian)
cd ../frontend
npm test
```

---

## 7. Referensi & Panduan Teknis

- [Panduan Teknis 7 Flow Langflow](langflow/README.md)
- [Dokumentasi Layanan Backend](backend/README.md)
- [Dokumentasi Antarmuka Web Workspace](frontend/README.md)
- [Instruksi Konfigurasi IBM Bob MCP](mcp/bob_agent_instructions.md)
