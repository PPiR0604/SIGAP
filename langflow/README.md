# SIGAP (Sistem Intelijen Logistik dan Asisten Posko) — Flow Langflow

**Pembaruan 22 Oktober 2026:** sumber utama rekap sekarang SQLite milik Langflow. Ekspor reader/writer/validator telah diperbarui beserta pemeriksaan konflik, persetujuan per field, transaksi dan riwayat perubahan. Impor CSV tersedia di web. Panduan terbaru: [SQLITE_MIGRATION.md](SQLITE_MIGRATION.md). Keterangan CSV/Sheets di bagian historis berikut menjelaskan adaptor lama.

Tujuh export flow untuk di-import dan diuji di **Langflow Desktop**. Export terbaru dibangun offline memakai template node versi **1.12.4**; kompatibilitas versi lain dan eksekusi Playground belum dibuktikan oleh build ini.
Setiap flow = satu tool MCP yang dipanggil IBM Bob.

**Status demo per 3 Oktober 2026:** ekspor dialog lengkap Bob `8e326488…` menunjukkan panggilan ketujuh tool sampai kalkulasi dan pratinjau buletin. Bob melaporkan 28 posko tersimpan, clear disability R038 diterapkan, dan read-back `verified`; kalkulator/buletin memakai referensi berikutnya setelah read-back yang sama. Respons mentah backend/versi runtime belum lengkap dan Google Docs belum dibuat dalam dialog. Dokumentasi acuan tersedia di folder pengujian.

Hasil pengujian kode terakhir yang tercatat: **156 tes Python dan 9 tes Apps Script mock lulus**. Metadata export `runtime_validation: pending` mengacu build offline; bukti dialog pengguna dicatat terpisah. Pembaruan dokumentasi ini tidak menjadi hasil tes baru.



**Arsitektur terbaru, 5 Oktober 2026:** ekstraksi laporan memakai LLM API kompatibel OpenAI di dalam `prepare_needs`. Bob menangani percakapan dan tool MCP; validasi/kalkulasi/write tetap deterministik. Pengujian lokal API menggunakan transport mock; provider nyata dan Playground masih pending. 

| File | Tool MCP | LLM? | Karakter | Fungsi |
| :--- | :--- | :---: | :---: | :--- |
| `flows/fetch_shelters.json` | `fetch_shelters` | — | 14 | Baca kondisi posko tersimpan di Google Sheets/CSV saat sesi baru / inisiasi |
| `flows/prepare_needs.json` | `prepare_needs` | API | 13 | Samarkan PII → prompt → LLM API → validator → kandidat snapshot |
| `flows/validate_needs.json` | `validate_needs` | — | 14 | Cek tipe/rentang, hubungan angka-label sumber, konsistensi jumlah dan field kosong |
| `flows/calculate_gap.json` | `calculate_gap` | — | 13 | Kebutuhan air/pangan/jamban/hunian (rumus Sphere) + skor prioritas |
| `flows/flag_anomalies.json` | `flag_anomalies` | — | 14 | Tandai laporan ganda & posko senyap > 24 jam |
| `flows/upsert_shelter.json` | `upsert_shelter` | — | 14 | **HITL**: UPSERT terkontrol, menolak laporan usang, menjaga field kosong |
| `flows/draft_bulletin.json` | `draft_bulletin` | — | 14 | Pratinjau draf; Google Docs memerlukan persetujuan khusus terikat hash isi |

Ekstraksi model bersifat probabilistik dan dapat salah; hasil wajib melalui validator. Rumus kebutuhan dan gerbang penyimpanan tetap dijalankan kode.

Ekstraksi sekarang berada di Langflow sesuai arsitektur resmi SIGAP. Regex berjalan sebelum API ekstraksi, tetapi sesudah Bob menerima input; demo tetap memakai data fiktif sampai penyaringan sebelum Bob tersedia.

**Kontrak baru setelah uji dialog:** kalkulator, detector dan gerbang write tidak lagi menerima JSON records bebas. Sumber dan kandidat snapshot disimpan di server; tool berikutnya hanya menerima referensi dan hash. Import ulang semua export dan gunakan instruksi Bob terbaru.

```
langflow/
├── flows/        ← file .json untuk di-import
├── components/   ← kode sumber custom component (sudah tertanam di dalam .json)
└── prompts/      ← prompt ekstraksi (sudah tertanam di flow prepare_needs)
```

## 1. Import ke Langflow Desktop

1. Buka Langflow Desktop → buat project baru, misalnya **SIGAP**.
2. Klik **Upload** / **Import** (ikon unggah di halaman project) → pilih ketujuh file di `langflow/flows/`.
3. Buka tiap flow. Custom component sudah berisi kodenya, tidak perlu menempel apa pun.
4. Semua flow harus memakai direktori state yang sama dan dapat ditulis. Set environment server `SIGAP_SNAPSHOT_DIR` ke path absolut bila working directory tidak tetap. Default: `output/.sigap_snapshots`. Referensi kedaluwarsa setelah 24 jam. Atur akses/retensi dan hapus state demo setelah pengujian; jangan memasukkan folder state ke artefak submission.

> Jika Langflow menampilkan tanda "update/outdated" pada Chat Input/Output, klik update — aman.

## 2. Konfigurasi LLM API ekstraksi

Pada proses server Langflow, atur `SIGAP_LLM_BASE_URL` (base HTTPS, misalnya endpoint provider berakhiran `/v1`), `SIGAP_LLM_MODEL` (ID model yang tersedia), dan `SIGAP_LLM_API_KEY`. Restart server setelah mengubah environment. Alternatifnya isi ketiga field pada node **OpenAI Report Extractor**; key memakai field rahasia dan harus dikosongkan saat export.

Komponen memanggil `POST <base_url>/chat/completions`, dengan `temperature=0`, `max_tokens=8192` dan timeout 60 detik. Provider harus mendukung parameter tersebut dan output teks JSON. Bukan endpoint Responses atau API watsonx native. Model tidak dipilih otomatis; nilai belum lengkap menghentikan flow. Redirect HTTP ditolak untuk melindungi Authorization. Key API model berbeda dari key MCP Langflow.

Alur `prepare_needs`: Chat Input → Posko Report Preprocessor → Prompt Template → OpenAI Report Extractor → Shelter Report Validator → Chat Output. Preprocessor juga memasok referensi sumber langsung ke extractor. ID/hash sumber ditetapkan server, bukan dipercaya dari output model.

Output akhir memuat `records`, `snapshot_records`, `snapshot_id`, `snapshot_sha256`, provenance dan konflik. Bob memakai referensi tersebut untuk `flag_anomalies`/`calculate_gap`; tidak mengekstrak JSON sendiri atau memanggil `validate_needs` lagi pada alur normal. Validator mandiri dipertahankan untuk diagnostik. Koreksi laporan menjalankan `prepare_needs` ulang dan memerlukan pratinjau/persetujuan baru.

Jika API gagal, timeout, JSON invalid, report_id tidak dikenal/duplikat, atau respons terpotong, flow berhenti. Tidak ada fallback ekstraksi Bob, kalkulasi atau write otomatis. Batas sumber 200 KiB adalah batas input, bukan jaminan muat konteks model; bagi batch jika diperlukan.

## 3. Hubungkan Google Sheets & Docs (opsional untuk demo)

Tanpa langkah ini flow tetap berjalan dalam **mode demo**: data disimpan ke CSV lokal (`output/rekap_posko.csv`) atau ditampilkan untuk disalin manual.

1. Buat Google Sheet baru → **Extensions → Apps Script** → tempel `integrations/google_apps_script/Code.gs`.
2. Ganti `SHARED_SECRET` dengan teks acak buatan Anda.
3. **Deploy → New deployment → Web app** · Execute as: *Me* · Who has access: *Anyone* → salin URL.
4. Isi **Webhook URL** dan **Shared Secret** (opsi lanjutan) yang sama pada ketiga flow:
   - `fetch_shelters` → **Logistics Storage Reader**.
   - `upsert_shelter` → **Logistics Storage Writer**.
   - `draft_bulletin` → **Google Workspace Webhook** (aksi `create_doc`).
5. Untuk demo CSV, gunakan **Lokasi File CSV** yang sama pada reader dan writer. Path default `output/rekap_posko.csv` relatif terhadap folder kerja Langflow. Buletin tanpa webhook ditampilkan di Chat Output untuk disalin manual.

Reader mengembalikan schema kanonis (`shelter_name`, `village`, `total_people`, `reported_at`), angka integer dan kosong sebagai `null`. Pembacaan Google yang sukses tetapi kosong tidak diganti data CSV. Jika write Google gagal/timeout, writer meminta pemeriksaan status sebelum retry dan **tidak** menulis fallback CSV; status remote bisa belum diketahui.

**Read-back:** gunakan teks JSON `{"action":"all"}`. Perintah seperti "cek semua posko yang baru disimpan" juga dibaca sebagai all. Filter eksplisit `{"action":"filter","term":"Harapan"}` menghasilkan `no_matches` bila tidak cocok; tidak menyebut sumber kosong. Output awal `SIGAP_READ_RESULT` memuat sumber, total/matched count dan referensi snapshot aktual dari penyimpanan. Sumber Google menyertakan URL sheet/tab bila tersedia.

**Deployment Apps Script:** perbarui `Code.gs` dan deploy revisi terbaru, sambil mempertahankan shared secret organisasi yang sudah dikonfigurasi. Backend kini memeriksa/menggabungkan metadata JSON per item pada pembaruan parsial. Header lama dimigrasikan aditif berdasarkan nama kolom; tidak perlu menghapus data sheet untuk menguji upgrade.

### Kontrak pembaruan dan stok

- Gunakan `disaster_id` + `shelter_id` stabil jika tersedia; jika tidak, UPSERT membutuhkan nama posko dan desa yang sama persis setelah normalisasi. `report_id` tidak dipakai sebagai identitas posko.
- Field kosong pada pembaruan menjaga nilai lama. Usulan clear pada sumber menjadi `pending_clear_fields`, bukan penghapusan otomatis. Persetujuan khusus memakai `approved_clear_fields` (report_id snapshot ke array field) dan `confirmed_clear_fields:true`; gate mengubahnya ke clear_columns. Identitas/lokasi/waktu dilindungi.
- Laporan lebih lama ditolak. Migrasi header aditif mempertahankan nilai berdasarkan nama kolom pada path CSV/sheet yang sama; perubahan schema nonaditif ditolak.
- Kandidat snapshot dibentuk server setelah validasi per laporan, berdasarkan urutan waktu sumber; metadata report_id/reported_at tidak bebas diubah Bob. `field_provenance` dan `source_report_ids` menjelaskan nilai yang dibawa dari laporan lama. Konflik seperti 45+55 != total terbaru 98 tetap ditandai. Data rentan kosong dapat menghasilkan `BELUM PASTI`.
- Stok di-merge **per item**: dictionary semua null tidak menimpa stok lama, nol eksplisit memperbarui, dan metadata/provenance tetap mengikuti waktu masing-masing item. Catatan terbaru berada pada notes; catatan lama dipertahankan pada notes_history. Bila laporan terbaru tidak memiliki catatan, kolom catatan kini kosong dan riwayat tetap tersedia.
- Air yang sudah datang tetapi masih kurang tetap tercatat sebagai kebutuhan; validator menambahkan bukti kutipan untuk pola shortage eksplisit yang terlewat oleh ekstraksi. Ini heuristik, bukan inferensi jumlah gap.
- Barang datang saja bukan surplus. Validator membuang `surplus_do_not_send` yang tidak didukung pernyataan cukup/berlebih/jangan kirim pada sumber dan mencatat issue. Prompt melarang menandai obat/selimut cukup hanya karena sudah diterima. Kirim teks asli persis ke prepare_needs; hash sumber tidak mendeteksi perubahan yang dibuat Bob sebelum pengiriman.
- Gap perlu stok numerik nonnegatif dan `stock_context` di record ekstraksi untuk validate_needs, **bukan** payload kalkulator. Contoh record:

```json
{"records":[{"shelter_name":"Masjid","village":"A","total_people":100,"stock":{"air_liter_per_hari":500},"stock_context":{"air_liter_per_hari":{"unit":"L","horizon_hours":24,"recorded_at":"2026-10-02 07:00"}}}]}
```

Unit yang diterima: `L`, `kkal`, `unit`, `m2`. Air/pangan memerlukan horizon 24 jam. Stok tidak diketahui atau metadata tidak cocok -> gap belum diketahui; kebutuhan tetap bisa dihitung.

**Batas kebaruan stok saat ini:** kalkulator memeriksa angka, unit, format waktu dan horizon; belum membandingkan berakhirnya periode stok dengan waktu pemeriksaan baru. Gap adalah hasil berdasarkan stok tercatat, bukan jaminan kekurangan saat ini. Penanda sumber lama pada buletin dan expiry referensi lokal tidak menggantikan pemeriksaan kebaruan stok. Penyempurnaan ini masuk backlog D1, bersama penjelasan gap/skor dan bukti Docs, pada catatan pengujian.

Alias eksplisit `stock_context.water.value`/`unit:liter` dapat dinormalisasi menjadi stok kanonis; galon tidak dikonversi. Kuantitas, horizon dan waktu stok diperiksa terhadap sumber. Horizon 48 jam tidak diubah menjadi 24.

### Persetujuan write rekap

Tampilkan snapshot dan hash, lalu minta persetujuan spesifik. Input upsert:

```json
{"snapshot_id":"ID_DARI_VALIDATOR","snapshot_sha256":"HASH_DARI_VALIDATOR","approved_snapshot_sha256":"HASH_PRATINJAU_YANG_DISETUJUI","confirmed_by_officer":true,"officer_note":"Petugas menyetujui isi pratinjau","allow_partial":true}
```

`allow_partial` hanya setelah petugas menyetujui field kosong/konflik dan batas rekap parsial. "Lanjut menghitung" bukan izin memulihkan angka yang ditolak. Koreksi harus melalui prepare/validate ulang dan mendapatkan referensi/persetujuan baru. Lakukan fetch_shelters untuk read-back setelah writer sukses.

**Keputusan clear wajib eksplisit.** Salin key dari `available_clear_actions`, misalnya `{"R038":["disability"]}`; key `R038 snapshot` tidak valid. Untuk clear, tambahkan `approved_clear_fields` dan `confirmed_clear_fields:true`. Untuk mempertahankan/menunda, gunakan `clear_decisions:{"R038":{"disability":"keep"}}` atau `"defer"`, serta `confirmed_clear_decisions:true` setelah pilihan petugas. Tanpa keputusan untuk semua usulan, write ditolak. `officer_note` tidak menjalankan aksi; retry tidak boleh menghapus parameter clear yang gagal.

Konflik sesudah merge tampil pada `snapshot_issues` dan bagian KONFLIK SNAPSHOT sebelum PRATINJAU KANONIS. Salin tabel kanonis: Cibening 91 bukan estimasi, dan kebutuhan terbaru "popok" tidak boleh diubah menjadi "popok ukuran L" tanpa penjelasan sumber lama. Jamban/hunian dapat dilengkapi unit/waktu hanya dari label kuantitas dan satu waktu pemeriksaan yang eksplisit dengan rujukan "saat pemeriksaan itu"; rujukan ambigu tetap unknown.

Gerbang menyimpan otorisasi write lokal dan writer menolak perubahan rows setelah persetujuan. **Setelah backend sukses**, `SIGAP_WRITE_RESULT` mengembalikan snapshot_id/hash efektif baru yang mencakup clear dan koreksi. Kandidat lama ditandai superseded. Jika gagal/timeout, tidak mempublikasikan revisi; jika data sudah ditulis tetapi revisi lokal gagal (`saved_revision_pending`), baca ulang, jangan retry write. Gunakan referensi aktual read-back setelah memeriksa data untuk aksi berikutnya.

**Verifikasi aksi server:** panggil fetch_shelters dengan `{"action":"all","expected_snapshot_id":"ID efektif dari writer","expected_snapshot_sha256":"hash efektif writer"}`. `verification.status=verified` berarti record dan aksi yang diharapkan cocok; `mismatch` mencetak differences walau 28 baris ada. Sumber, batch/report ID, waktu, nilai diketahui, stok/context dan clear diperiksa. Baca tanpa expected ref menghasilkan `not_requested`, bukan bukti semua aksi sudah diterapkan. Jika revisi lokal gagal, baca aktual dan periksa manual sampai referensi efektif tersedia.

**Perhitungan efektif:** setelah write/read-back, panggil calculate_gap ulang dengan referensi terbaru sebelum menampilkan hasil data tersimpan. Clear disability mengubah skor dan alasan prioritas walau gap/total populasi tidak berubah. Bobot skor adalah heuristik SIGAP; Sphere hanya acuan kebutuhan dasar.

Kolom tambahan: stok_json, konteks_stok_json, provenance_json, sumber_laporan_json, masalah_validasi_json, angka_tidak_terverifikasi_json, field_kosong_json, masalah_stok_json, riwayat_catatan_json, riwayat_koreksi_json, usulan_clear_json, estimasi, status_validasi. JSON diparse kembali oleh reader. `DIKONFIRMASI PETUGAS` berarti persetujuan simpan; `status_validasi` terpisah: PARSIAL, PERLU_KLARIFIKASI atau LOLOS_PEMERIKSAAN. Nol tetap nol pada reader/buletin; penanda estimasi ikut tersimpan.

### Persetujuan pembuatan Google Docs

1. Panggil `draft_bulletin` dengan referensi snapshot **efektif/read-back terbaru**, `disaster_name`/`contact` opsional. Kandidat sebelum write/clear tidak lagi diterima. Output pertama berisi pratinjau JSON (`content`, `content_sha256`, `preview_at`) dan penolakan aksi eksternal karena belum disetujui.
2. Tampilkan `content` persis; minta persetujuan khusus **membuat Google Docs atas isi ini**. Waktu `Dibuat` terpisah dari rentang waktu sumber. Draf menyebut sumber >24 jam/tidak diketahui, estimasi hanya bila sumber estimasi, konflik/jumlah belum valid, dan cakupan surplus per desa. Frekuensi permintaan bukan ranking distribusi; pernyataan cukup suatu lokasi bukan larangan kirim global.
3. Setelah disetujui, kirim ulang referensi snapshot, metadata dan `preview_at` yang sama dengan `confirmed_create_doc: true` dan `approved_content_sha256` sama dengan hash pratinjau. Builder menghitung ulang isi; webhook dan Apps Script memeriksa hash sebelum membuat dokumen.
4. Perubahan isi, termasuk nama bencana/kontak dalam jawaban persetujuan, memerlukan pratinjau baru tanpa konfirmasi Docs dan persetujuan ulang. Persetujuan penyimpanan rekap tidak memberi izin membuat Docs. Pemeriksaan sebelum publikasi tetap diperlukan.

Hash mengikat isi dan cakupan aksi, tetapi belum membuktikan identitas/persetujuan manusia lewat saluran independen.

## 4. Aktifkan MCP Server & sambungkan ke IBM Bob

1. Di project SIGAP → tab **MCP Server**. Pastikan ketujuh flow aktif sebagai tool.
   Nama tool mengikuti batas proyek ≤ 15 karakter. Deskripsi memuat tindakan, tipe input, dan batas kapan tool tidak boleh dipanggil.
2. Buat API key: **Settings → Langflow API Keys**.
3. Salin JSON konfigurasi dari tab MCP Server (paling akurat untuk port Desktop Anda), atau pakai
   templat `mcp/bob_mcp_config.json` dan ganti `GANTI_DENGAN_LANGFLOW_API_KEY`, `GANTI_DENGAN_PROJECT_ID`, serta port.
4. Di IBM Bob: tambahkan server MCP tersebut, pastikan ketujuh tool terdeteksi.
5. Tempel instruksi agen dari `mcp/bob_agent_instructions.md`.

## 5. Skenario uji (Outside-In, Outside-In Protocol)

| Layer | Uji | Hasil yang diharapkan |
| :--- | :--- | :--- |
| 1 · Flow | Playground `prepare_needs` dengan model/key terkonfigurasi dan laporan WhatsApp | API menerima sumber tersaring; output snapshot/provenance tervalidasi |
| 1 · Flow | prepare_needs untuk laporan 120 jiwa; calculate_gap dengan referensi snapshot | Air 1.800 L/hari, pangan 252.000 kkal/hari bila ekstraksi tervalidasi; records bebas ditolak |
| 1 · Flow | Playground flow `upsert_shelter` dengan JSON tanpa `confirmed_by_officer` | `DITOLAK — data TIDAK disimpan` |
| 2 · MCP | Tab MCP Server | 7 tool dengan nama ringkas lengkap |
| 3 · Bob | Daftar tool di Bob | 7 tool `sigap` terdeteksi |
| 4 · Dialog | Rekap → clear/parsial → write → read-back → hitung → buletin | Persetujuan snapshot/clear sesuai; expected ref menghasilkan status verifikasi; kalkulator/buletin memakai referensi setelah read-back yang sama. |

### Alur terbaru dan bukti demo sebelumnya

Alur export API terbaru di bawah belum diuji melalui dialog Bob. Pada dialog lama `8e326488…`, langkah ekstraksi masih dilakukan Bob lalu `validate_needs`; kalkulasi diminta **setelah** penyimpanan. Angka setelah diagram berasal dari dialog lama tersebut:

```text
fetch_shelters → prepare_needs (preprocessor → prompt → API → validator) → flag_anomalies
→ pratinjau konflik/clear → persetujuan → upsert_shelter → fetch_shelters (expected ref)
→ calculate_gap (ref setelah read-back) → draft_bulletin (ref yang sama) → pratinjau DRAF
```

Kalkulasi kandidat sebelum write tetap tersedia untuk analisis; bila hasil ditampilkan setelah write/clear, gunakan referensi terbaru. Izin simpan tidak mencakup Google Docs.

Hasil yang disampaikan: **1.715 jiwa parsial**, **25.725 L/hari** air, **3.601.500 kkal/hari** pangan; gap Harapan **970 L/100.800 kkal**, Bening **1.500 L**, Teduh **0 L**, Nusa belum diketahui karena horizon 48 jam. Angka kebutuhan bukan total kekurangan dan sebagian populasi merupakan estimasi.

Detector senyap memakai waktu simulasi **02/10 12.00 WIB** dan menunjukkan **7 posko**. Buletin dibuat **03/10 11.59 WIB** dan menandai sumber/kebutuhan **28 posko** lebih dari 24 jam. Dua hasil tersebut memakai waktu acuan berbeda. Perhitungan gap mengikuti stok historis; rincian bukti dan penyempurnaan ditunda ada pada catatan status demo.

## Membangun ulang flow dari kode sumber

Jika mengubah file di `components/` atau `prompts/`, bangun ulang JSON dengan server Langflow yang berjalan:

```bash
python scripts/build_langflow_flows.py --url http://127.0.0.1:7860 --api-key <LANGFLOW_API_KEY>
```

Tanpa server, gunakan template node export yang sudah tersedia:

```bash
python -B scripts/build_langflow_flows.py --offline
```

Build offline menyinkronkan kode komponen dan struktur flow, tetapi tidak memvalidasi komponen lewat server. Perubahan interface node baru perlu build online. Metadata `runtime_validation: pending` tidak boleh disebut bukti tes Playground.

Unit test logika komponen (butuh `pytest` dan `httpx`; `lfx` dari Langflow digunakan jika tersedia, selain itu tes memakai stub):

```bash
python -m pytest tests -q
node --test tests/test_google_apps_script.cjs
```

Helper `sigap_contracts/` disematkan generator ke tiap komponen yang memakainya; export tidak membutuhkan instalasi modul repo. Tes Python dapat memakai stub `lfx`; tes Apps Script memakai mock Google. 
