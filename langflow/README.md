# Workflow Langflow SIGAP

Langflow menjalankan workflow yang dipanggil backend melalui MCP. Instalasi Supabase saat ini menggunakan **tujuh export di [`flows/supabase/`](flows/supabase/)**, bukan export lokal SQLite di `flows/`.

Untuk demo lokal dari clone baru, gunakan [installer Docker](../deployment/local/README.md); impor manual di bawah ditujukan untuk instalasi terpisah/cloud.

| Flow | Fungsi |
| --- | --- |
| `fetch_shelters` | Membaca rekap dan mengembalikan referensi sumber |
| `prepare_needs` | Menyiapkan sumber laporan untuk validasi |
| `validate_needs` | Memvalidasi kandidat, konflik dan perubahan |
| `calculate_gap` | Menghitung acuan kebutuhan dan gap berdasarkan referensi snapshot |
| `flag_anomalies` | Memeriksa anomali laporan |
| `upsert_shelter` | Menulis perubahan yang telah disetujui |
| `draft_bulletin` | Menyusun draf buletin |

Nama MCP yang dipakai runtime adalah `sigap_0_fetch_shelters` sampai `sigap_6_draft_bulletin`, sesuai [pemetaan backend](../backend/src/acp/toolNames.ts). Nama flow yang spesifik membantu model memilih operasi yang sesuai.

Tool analisis `analyze_shelter_needs` berada di backend dan mengomposisi flow pembacaan/perhitungan di atas. Tool ini tidak menambah flow Langflow kedelapan atau menyatukan semua proses ke satu flow. Scope sumber dan hasil kalkulasi tetap diverifikasi sebelum ditampilkan.

## Setup

1. Siapkan Supabase dan gateway seperti [panduan backend](../backend/AUTH_SUPABASE.md).
2. Impor tujuh file JSON dari `flows/supabase/` ke satu project Langflow dan aktifkan sebagai tool MCP. Jangan menyertakan kredensial dalam export yang dibagikan.
3. Atur `SIGAP_BACKEND_INTERNAL_URL` pada **proses Langflow** ke alamat backend yang dapat dijangkau. Backend perlu URL dan key MCP di `.env` root. Jika backend berjalan dalam Docker dan Langflow di host, perhatikan alamat yang berlaku dari masing-masing proses.
4. Uji flow di Playground dengan konteks autentikasi yang sesuai, lalu MCP dan alur aplikasi. Flow cloud membutuhkan capability bertanda tangan dari backend; panggilan tanpa konteks tidak membuktikan jalur aplikasi berhasil.

`calculate_gap` menerima ID dan hash snapshot, bukan records atau stok bebas. Backend memvalidasi bahwa hasil mengacu ke sumber yang benar. Penyimpanan memerlukan persetujuan petugas dan baca ulang; kegagalan perhitungan tidak boleh dianggap sukses.

## Acuan perhitungan

Kebutuhan menggunakan acuan populasi seperti air 15 L/orang/hari dan energi 2.100 kkal/orang/hari. Rincian kelompok adalah alokasi acuan populasi, bukan kebutuhan gizi khusus usia. Gap memerlukan stok dan metadata yang valid; stok tidak diketahui bukan nol. Lihat [SPHERE_PLANNING.md](SPHERE_PLANNING.md) untuk asumsi dan keterbatasan.

## Pengembangan dan pengujian

Teks tempelan mendukung ekspor WhatsApp, pemisah `---`/dua baris kosong, dan judul pesan seperti `08.00 — Petugas Posko Sejahtera, Desa Karangmulya` (dengan atau tanpa Markdown). Tiap judul mendapat ID laporan sendiri; paragraf di dalam pesan tetap menjadi satu laporan. Untuk kartu yang hanya mencantumkan jam, tambahkan `Tanggal acuan seluruh laporan: 10 November 2026, WIB.` dengan tanggal yang sesuai sumber. Tanpa tanggal yang jelas, waktu tetap belum diketahui. Pesan terusan mempertahankan waktu asli yang tertulis pada judulnya.

Validator menolak penerbitan kandidat parsial jika ID ekstraksi ganda/tidak sesuai sumber, atau pesan posko dengan jumlah jiwa eksplisit terlewat. Model dapat memperbaiki ekstraksi memakai sumber yang sama; penyimpanan tetap memerlukan tinjauan dan persetujuan petugas. Pesan admin yang bukan laporan boleh dilewati.

Teks tambahan sebelum kartu dipertahankan sebagai pesan sumber tersendiri, sehingga tidak menggabungkan kartu menjadi satu ID. Tanggal acuan hanya digunakan jika deklarasinya jelas dan tunggal; tanggal yang ambigu tetap belum diketahui. Pemeriksaan kelengkapan juga mengenali format berlabel seperti `Jumlah jiwa: 10`.

Sumber komponen berada di `components/` dan helper di `lib/`; export Supabase dibangun oleh `scripts/build_supabase_flows.py`. Setelah perubahan, verifikasi export dan deployment yang dipakai Langflow: mengubah file repo saja tidak otomatis mengubah flow yang sudah diimpor. Jalankan pengujian lokal yang relevan dan uji Playground → MCP → runtime → dialog dengan data sintetis. Test mock bukan bukti provider atau database live berhasil.

Export lokal SQLite dan [panduan migrasinya](SQLITE_MIGRATION.md) dipertahankan sebagai rujukan migrasi, bukan konfigurasi Supabase aktif. Bob ACP memerlukan verifikasi tersendiri; adapter backend pada autentikasi Supabase saat ini fail-closed.
