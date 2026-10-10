# SIGAP Backend Service

Layanan backend lokal (Node.js 22+ / Fastify / TypeScript) yang menghubungkan **SIGAP Web Workspace** ke **Gemini API** dan **Langflow MCP**. Adapter Bob ACP tetap tersedia sebagai pilihan provider.

---

## 1. Arsitektur & Alur Data

```text
[Web Workspace] <--(HTTP + SSE)--> [Backend SIGAP] <--(API)--> [Gemini]
                                      |
                                  MCP HTTP
                                      |
                                  [Langflow] <--> [CSV / Sheets]
```

### Pemisahan Tanggung Jawab
- **Web**: Antarmuka operator posko, visualisasi rekap, input laporan, keputusan persetujuan manusia (*Human-in-the-Loop*).
- **Backend**:
  - Manajemen sesi dan batch (1 proses aktif per sesi).
  - Penyaringan PII awal (*regex redaction* untuk NIK, HP, Rekening, Email) sebelum teks diteruskan ke model.
  - Abstraksi klien ACP JSON-RPC (`AcpJsonRpcClient` dan `AgentRuntime`).
  - Penegakan gerbang persetujuan server (*fail-closed* sebelum tool write `upsert_shelter` dijalankan).
  - Normalisasi dan audit log metadata lokal pada SQLite (`node:sqlite`).
- **Gemini**: Agen percakapan/ekstraksi yang meminta tool; backend memeriksa izin sebelum mengirim tools/call. Mode Bob kompatibel memakai ACP.
- **Langflow**: Eksekusi workflow ekstraksi laporan, validasi data terpilah, kalkulasi gap Sphere, deteksi anomali, penyimpanan, dan draf buletin.

---

## 2. Cara Menjalankan

### Persyaratan
- Node.js >= 22 (direkomendasikan v22 atau v24).

### Instalasi & Menjalankan Server
```powershell
cd backend
npm install
npm start
```

Server akan mengikat ke `http://127.0.0.1:8787`.
Token sesi lokal otomatis dibuat dan disimpan di `backend/data/session-token.txt`.

Default provider adalah Gemini. Isi file lokal **yang diabaikan Git** `backend/data/gemini.local.json`:

```json
{"apiKey":"KEY_GEMINI_ANDA","model":"gemini-3.8-flash"}
```

Alternatif: set `GEMINI_API_KEY` dan `GEMINI_MODEL` di environment backend. Environment mengalahkan file lokal; string key kosong secara eksplisit menonaktifkan ketersediaan. `SIGAP_GEMINI_CONFIG_PATH` dapat menunjuk file lain. Restart backend setelah mengubah key/model. Tidak ada key di frontend atau VITE_*. File `.env.example` adalah template dan tidak dimuat otomatis.

MCP Gemini membaca `SIGAP_MCP_CONFIG_PATH` atau file lokal `backend/data/langflow-mcp.local.json` secara default. URL klien MCP ini dibatasi loopback. Untuk menguji koneksi dan preview sintetis:

```powershell
$env:SIGAP_MCP_CONFIG_PATH = 'data/langflow-mcp.local.json'
npm run probe:mcp
npm run smoke:gemini
```

Probe hanya initialize/list. Smoke memakai Gemini nyata untuk prepare/validate dan melarang writer, fetch rekap, kalkulasi serta publikasi. Jika key belum diisi, smoke berhenti dengan pesan konfigurasi. [Katalog resmi Gemini](https://ai.google.dev/gemini-api/docs/models) menjadi acuan model; default dapat diganti menurut akses akun.

Untuk simulasi tanpa API: `$env:SIGAP_AGENT_PROVIDER='mock'; npm start`. Untuk Bob: pilih `bob` dan isi konfigurasi ACP di bawah. Gemini tanpa key/config tetap degraded/error, tidak berubah menjadi mock.

### Menjalankan Pengujian
```powershell
npm test
```
Menjalankan unit test dan integration test meliputi validasi input, PII, parsing payload tool, approval gate, keamanan Origin/Token, SSE replay, startup dengan database baru, dan kontrak ACP lewat subprocess fixture. `npm run build` memeriksa tipe; `npm start` dan `npm run dev` menjalankan sumber TypeScript melalui `tsx`.

### Menjalankan Spike Uji Kelayakan ACP (Task 0)
```powershell
npm run spike:acp
```
Menjalankan probe otomatis untuk mendeteksi runtime `bob` dan menguji koneksi ACP.

---

## 3. Kontrak API (PRD Bagian 12)

| Method | Endpoint | Deskripsi | Auth |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/health` | Status backend, provider agen, storage, dan mode | Publik |
| `POST` | `/api/sessions` | Membuat sesi baru posko | Bearer Token |
| `POST` | `/api/sessions/:id/messages` | Mengirim laporan / pertanyaan, menyaring PII, memulai proses | Bearer Token |
| `GET` | `/api/sessions/:id/events` | Aliran event SSE (`processing_started`, `preview_ready`, dll.) | Bearer Token |
| `GET` | `/api/batches/:id` | Mengambil status batch dan payload kanonis untuk pemulihan UI | Bearer Token |
| `POST` | `/api/batches/:id/decisions` | Menyimpan keputusan persetujuan write operator server | Bearer Token |

---

## 4. Model Keamanan & Responsible AI

1. **Loopback Binding**: Backend hanya mengikat pada `127.0.0.1` (mencegah eksposur ke jaringan publik tanpa autentikasi).
2. **CORS & Origin Guard**: Request mutasi dan SSE hanya diterima dari allowlist (`http://127.0.0.1:5173`, `http://localhost:5173`). Request lintas-situs asing ditolak dengan kode `403`.
3. **Local Bearer Token**: Setiap request API (kecuali health check) wajib menyertakan token sesi lokal.
4. **Penyaringan Data Pribadi (PII)**: NIK (16 digit), nomor telepon, nomor rekening, dan email disamarkan sebelum data diteruskan ke LLM.
5. **Human-in-the-Loop (Gerbang Write Sekali Pakai)**:
   - Tool penulisan `upsert_shelter` ditolak jika belum ada persetujuan eksplisit dari operator di server.
   - Persetujuan mengikat batch, kandidat terbaru, ID, SHA-256, batas data parsial, dan keputusan clear/keep/defer. Jika data berubah, persetujuan sebelumnya dicabut (*revoked*).
   - Persetujuan dikonsumsi secara atomik sekali pakai (*one-time use*) untuk mencegah klik ganda.
   - Nama tool yang tidak dikenal ditolak. `draft_bulletin` hanya diizinkan untuk preview; publikasi Docs belum diaktifkan.
6. **Verifikasi Pasca-Write**: Status *"Tersimpan dan terverifikasi"* hanya ditampilkan jika pembacaan kembali (*read-back*) menghasilkan status `verified`. Jika `mismatch`, perbedaan ditampilkan transparan dan hasil tidak diklaim sukses.

---

## 5. Batasan & Status Uji Prototipe (Jujur Sesuai PRD)

- **Gemini dan MCP**: Health melaporkan agent/provider_status dan kesiapan konfigurasi, bukan keberhasilan end-to-end. Key/config yang belum tersedia menjadi degraded. MCP lokal nyata sudah mengembalikan tujuh tool; klaim Gemini nyata membutuhkan smoke nyata dengan key valid.
- **Write Control**: Runtime Gemini selalu meminta PermissionGate sebelum dispatch MCP; flag ACP tidak diperlukan untuk jalur ini. Persetujuan tetap sekali pakai dan parameter write harus persis. Adapter Bob tetap menolak write nyata sampai permission ACP dibuktikan.
- **Batas**: 12 putaran model, 24 panggilan tool, 60 detik/request Gemini, 120 detik/request MCP, 5 menit/operasi dan 1 MiB history/sesi. History hanya dalam RAM; overflow meminta sesi baru. Untuk menekan token input, model hanya menerima satu salinan hasil tool (duplikat terformat/mentah dan `structuredContent` kembar dibuang; event backend tetap memakai hasil mentah), hasil tool operasi lama diganti penanda singkat (jawaban model tetap), kandidat rekap yang sedang ditinjau tidak dipangkas sampai ditulis, dan riwayat lintas operasi dijaga di sekitar 96 KiB dengan membuang operasi tertua. Setiap request Gemini mencatat `usageMetadata` (prompt/output/total token) di log `Gemini usage`, dan ringkasan per operasi di `Gemini operasi selesai`. Tidak ada retry otomatis untuk API atau tools/call.
- **Hackathon**: Gemini menggantikan Bob atas pilihan pengguna, sehingga jalur utama berbeda dari arsitektur wajib Bob pada panduan hackathon. Adapter Bob tetap tersedia.

## 6. Konfigurasi Bob dan MCP nyata

Konfigurasi dibaca dari environment proses; file `.env.example` hanya template. Set variabel melalui PowerShell atau launcher Anda. Dari folder `backend`, database default berada di `data/sigap.db`; parent directory untuk `SIGAP_DB_PATH` kustom dibuat otomatis.

- `SIGAP_BOB_COMMAND`: path executable Bob. Pada Windows, shim `.cmd`/`.bat` tidak dieksekusi. Untuk distribusi berbasis Node, isi dengan path `node.exe` dan `SIGAP_BOB_ARGS` berupa array JSON berisi path entrypoint Bob serta argumen `acp`.
- `SIGAP_MCP_CONFIG_PATH`: path salinan lokal yang telah diisi dari `mcp/bob_mcp_config.json`. Simpan salinan berisi kredensial di direktori yang diabaikan Git, misalnya `backend/data/`. Placeholder ditolak. Konfigurasi dikonversi ke array `mcpServers` ACP dan dikirim bersama `cwd` absolut saat membuat sesi.
- `SIGAP_ACP_WRITE_CONTROL_VERIFIED=1`: hanya sesudah pengujian Bob nyata membuktikan permission request muncul **sebelum setiap write**, membawa identitas tool dan `rawInput` lengkap. Default `0` menolak write nyata. Melewatkan gerbang dengan `--trust` ditolak.

`POST /api/batches/:id/decisions` mengembalikan `202` untuk keputusan penyimpanan yang diterima, lalu melanjutkan prompt write dan read-back. Pengiriman keputusan ganda ditolak dengan `409`. Persetujuan lokal tidak sama dengan penyimpanan sukses.

Mode mock melaporkan `mode: mock_mode`, `storage: simulated`, `write_enabled: false`. Simulasi persetujuan dapat dijalankan untuk menguji alur, tetapi hasil akhirnya `simulated_done` dan event memuat `simulated: true`; tidak ada write ke CSV/Sheets. Koneksi nyata tanpa konfigurasi MCP melaporkan `degraded`. Health menunjukkan kesiapan konfigurasi/runtime, bukan bukti integrasi end-to-end.

Hanya receipt write yang didahului konsumsi approval dan read-back yang mengacu ID/hash receipt efektif yang bisa menghasilkan status `done`. Hasil mismatch menjadi `needs_review`; hasil tidak lengkap atau runtime gagal setelah keputusan menjadi `save_status_unknown` dan tidak di-retry write otomatis.

Percakapan lanjutan tanpa ekstraksi laporan dapat selesai sebagai `conversation_done`, tanpa snapshot baru dan tanpa membatalkan kandidat batch sebelumnya. Laporan yang sudah mulai prepare/validate tetapi belum menghasilkan kandidat tetap gagal sebagai `INCOMPLETE_EXECUTION`. Setiap operasi menerbitkan `processing_completed` setelah kunci sesi dilepas; event ini menandai operasi selesai, bukan bukti penyimpanan. Payload SSE menyertakan `batch_id` dan `request_id` agar frontend memasangkan kandidat dan persetujuan dengan batch yang tepat, termasuk ketika SSE mendahului respons HTTP. Persetujuan batch sebelumnya tetap diperbolehkan setelah percakapan selesai selama snapshot-nya masih berlaku; satu snapshot tidak boleh ditulis ulang dengan keputusan yang sama.

Adapter mengikuti kontrak [ACP session setup](https://agentclientprotocol.com/protocol/v1/session-setup), [prompt turn](https://agentclientprotocol.com/protocol/v1/prompt-turn), dan [tool calls/permissions](https://agentclientprotocol.com/protocol/v1/tool-calls). Pengujian kontrak lokal tidak menggantikan pengujian Playground Langflow → MCP → Bob → dialog end-to-end.

### MCP Langflow lokal yang sudah diverifikasi

Konfigurasi lokal berada di `backend/data/langflow-mcp.local.json` dan diabaikan Git. Jalankan dari folder `backend`:

```powershell
$env:SIGAP_MCP_CONFIG_PATH = 'data/langflow-mcp.local.json'
npm run probe:mcp
npm start
```

Probe hanya mengirim initialize, notifications/initialized dan tools/list ke loopback; tidak mengeksekusi flow. Pada 8 Oktober 2026 endpoint port 7860 merespons dengan tujuh tool `sigap_0_fetch_shelters` sampai `sigap_6_draft_bulletin`. Tipe `streamable-http` diterjemahkan menjadi MCP HTTP ACP. `disabled: true` diabaikan; `alwaysAllow` tidak diteruskan ke ACP.

Backend hanya mengenali tujuh alias terdaftar tersebut dan nama kanonisnya; prefix lain tetap ditolak. Flow dua tahap mengembalikan SOURCE_REF dari prepare; snapshot untuk persetujuan baru diterima dari validate. Flow prepare yang langsung mengembalikan snapshot tervalidasi tetap didukung. Instruksi Bob menjelaskan kedua kontrak agar kegagalan LLM API tidak diganti jalurnya diam-diam.

MCP aktif tidak otomatis membuktikan provider berhasil. Jalur Gemini memerlukan key API dan MCP; jalur Bob memerlukan SIGAP_BOB_COMMAND/SIGAP_BOB_ARGS dan SIGAP_ACP_WRITE_CONTROL_VERIFIED tetap default 0. Daftar alwaysAllow pada klien Bob lain perlu mengecualikan writer dan pembuatan dokumen agar persetujuan manusia tidak terlewati.

## 7. Penghematan token dan kuota Gemini

Penghematan yang aktif secara default:

- **Rekap tersimpan dibaca tanpa model.** Pada pesan pertama sesi, backend memanggil `fetch_shelters` langsung lewat MCP secara paralel dan mengirim hasilnya ke UI (event `stored_rekap_ready`). Model tidak membuat putaran tambahan dan hasil bacanya tidak masuk riwayat.
- **Hasil `prepare_needs` dibuang setelah validator berhasil.** Teks ekstraksi dan SOURCE_REF hanya dibutuhkan model sampai `validate_needs` dipanggil. Putaran berikutnya dan operasi sesudahnya membawa penanda singkat, sedangkan kandidat kanonis di hasil validator tetap utuh.
- **Anggaran riwayat lintas operasi turun dari 96 KiB ke 64 KiB.** Operasi tertua dibuang lebih awal. Kandidat yang sedang ditinjau tetap dilindungi.
- **Deskripsi tool dipotong 400 karakter** pada deklarasi yang dikirim ke Gemini. Skema parameter tidak diubah.
- **Log lebih rinci.** `Gemini usage` kini memuat `static_bytes` (instruksi + deklarasi tool) di samping `history_bytes`, sehingga terlihat bagian mana yang paling besar.

Penjaga kuota per menit:

- Backend mencatat `promptTokenCount` dari tiap respons dalam jendela geser 60 detik. Bila request berikutnya diperkirakan melewati batas, backend menunggu (UI menampilkan "Menunggu kuota token per menit") dan gagal dengan pesan jelas jika harus menunggu lebih dari 50 detik.
- Batas default 200000 token input per menit. Ubah lewat `tpmLimit` di `backend/data/gemini.local.json` atau `SIGAP_GEMINI_TPM_LIMIT`. Isi `0` untuk mematikan. Sesuaikan dengan batas model pada akun Anda (dashboard AI Studio menampilkan angkanya).
- Respons 429 dari Gemini kini dilaporkan sebagai `QUOTA_EXCEEDED`, dan sesi serta riwayat sebelumnya tidak dibuang.
