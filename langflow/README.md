# Workflow Langflow SIGAP

Langflow menjalankan workflow yang dipanggil backend melalui MCP. Instalasi Supabase saat ini menggunakan **tujuh export di [`flows/supabase/`](flows/supabase/)**, bukan export lokal SQLite di `flows/`.

| Flow | Fungsi |
| --- | --- |
| `fetch_shelters` | Membaca rekap dan mengembalikan referensi sumber |
| `prepare_needs` | Menyiapkan sumber laporan untuk validasi |
| `validate_needs` | Memvalidasi kandidat, konflik dan perubahan |
| `calculate_gap` | Menghitung acuan kebutuhan dan gap berdasarkan referensi snapshot |
| `flag_anomalies` | Memeriksa anomali laporan |
| `upsert_shelter` | Menulis perubahan yang telah disetujui |
| `draft_bulletin` | Menyusun draf buletin |

## Setup

1. Siapkan Supabase dan gateway seperti [panduan backend](../backend/AUTH_SUPABASE.md).
2. Impor tujuh file JSON dari `flows/supabase/` ke satu project Langflow dan aktifkan sebagai tool MCP. Jangan menyertakan kredensial dalam export yang dibagikan.
3. Atur `SIGAP_BACKEND_INTERNAL_URL` pada **proses Langflow** ke alamat backend yang dapat dijangkau. Backend perlu URL dan key MCP di `.env` root. Jika backend berjalan dalam Docker dan Langflow di host, perhatikan alamat yang berlaku dari masing-masing proses.
4. Uji flow di Playground dengan konteks autentikasi yang sesuai, lalu MCP dan alur aplikasi. Flow cloud membutuhkan capability bertanda tangan dari backend; panggilan tanpa konteks tidak membuktikan jalur aplikasi berhasil.

`calculate_gap` menerima ID dan hash snapshot, bukan records atau stok bebas. Backend memvalidasi bahwa hasil mengacu ke sumber yang benar. Penyimpanan memerlukan persetujuan petugas dan baca ulang; kegagalan perhitungan tidak boleh dianggap sukses.

## Acuan perhitungan

Kebutuhan menggunakan acuan populasi seperti air 15 L/orang/hari dan energi 2.100 kkal/orang/hari. Rincian kelompok adalah alokasi acuan populasi, bukan kebutuhan gizi khusus usia. Gap memerlukan stok dan metadata yang valid; stok tidak diketahui bukan nol. Lihat [SPHERE_PLANNING.md](SPHERE_PLANNING.md) untuk asumsi dan keterbatasan.

## Pengembangan dan pengujian

Sumber komponen berada di `components/` dan helper di `lib/`; export Supabase dibangun oleh `scripts/build_supabase_flows.py`. Setelah perubahan, verifikasi export dan deployment yang dipakai Langflow: mengubah file repo saja tidak otomatis mengubah flow yang sudah diimpor. Jalankan pengujian lokal yang relevan dan uji Playground → MCP → runtime → dialog dengan data sintetis. Test mock bukan bukti provider atau database live berhasil.

Export lokal SQLite dan [panduan migrasinya](SQLITE_MIGRATION.md) dipertahankan sebagai rujukan migrasi, bukan konfigurasi Supabase aktif. Bob ACP memerlukan verifikasi tersendiri; adapter backend pada autentikasi Supabase saat ini fail-closed.
