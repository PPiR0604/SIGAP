# Menjalankan SIGAP dengan Supabase lokal

Paket ini menjalankan web, backend, Langflow, serta komponen Supabase yang dibutuhkan SIGAP di Docker pada satu komputer. Supabase lokal terdiri dari beberapa container yang dikelola bersama; data disimpan di volume Docker bernama `sigap-local-*`. Konfigurasi cloud dan data cloud terpisah, tanpa sinkronisasi otomatis.

## Persiapan

1. Pasang dan jalankan Docker Desktop (atau Docker Engine dan Compose di Linux). Sediakan ruang penyimpanan dan memori yang cukup untuk beberapa container. Unduhan pertama dan build memerlukan koneksi internet dan dapat memakan waktu.
2. Siapkan API key, project ID, dan URL regional watsonx.ai milik pengguna demo. Project harus memiliki akses ke model `ibm/granite-4-h-small`.
3. Buka terminal pada folder proyek.

Di Windows PowerShell:

```powershell
.\start-sigap.ps1
```

Di Linux:

```bash
bash ./start-sigap.sh
```

Saat pertama kali diminta, masukkan project ID, URL regional, dan API key watsonx. API key tidak ditampilkan saat diketik. Setup membuat `.env.sigap-local` dan `.sigap-local-accounts.txt` di komputer tersebut; keduanya tidak disertakan dalam Git. Buka file akun untuk melihat kredensial admin, petugas, dan viewer. Jangan bagikan kedua file tersebut. Jika ingin mengubah kredensial watsonx, perbarui nilai terkait di `.env.sigap-local` lalu jalankan kembali perintah start.

Setelah pemeriksaan berhasil, buka **http://localhost:8080**. Kotak masuk email latihan tersedia di http://localhost:8025. Alamat localhost hanya dapat diakses dari komputer yang menjalankan Docker; akses juri dari komputer lain perlu pengaturan jaringan dan keamanan tersendiri.

Data contoh awal berisi delapan posko dan 630 jiwa. Data dan perubahan demo dipertahankan ketika layanan dihentikan dan dijalankan lagi. Proses inisialisasi tidak menimpa data yang sudah ada. Admin dapat mengelola ruang kerja, petugas mengakses posko yang ditugaskan, dan viewer dapat membaca publikasi. Tindakan penting tetap memerlukan persetujuan petugas sebagaimana di aplikasi.

## Memilih provider model

Installer pertama kali tetap meminta konfigurasi watsonx. Setelah `.env.sigap-local` dibuat, provider backend dapat dipilih pada file tersebut. Mengubah `.env` root tidak otomatis mengubah paket lokal.

| Provider | Pengaturan di `.env.sigap-local` |
| --- | --- |
| `watsonx` | `SIGAP_AGENT_PROVIDER=watsonx`, URL regional, project ID, API key, dan model pada variabel `SIGAP_WATSONX_*` |
| `openai` | `SIGAP_AGENT_PROVIDER=openai`, `SIGAP_OPENAI_BASE_URL`, `SIGAP_OPENAI_MODEL`, dan `SIGAP_OPENAI_API_KEY` |

Untuk endpoint lokal OpenAI-compatible, gunakan alamat yang dapat dijangkau dari container, misalnya `http://host.docker.internal:20128/v1`, dan model yang tersedia pada endpoint sendiri. Nama provider `openai` menyatakan protokol kompatibel, bukan jaminan identitas model. Backend membatasi alamat endpoint ke host lokal yang diizinkan oleh kode.

Compose lokal masih memvalidasi variabel watsonx yang dibuat installer meskipun provider backend dipilih `openai`; jangan menghapusnya ketika berganti provider. Runtime Gemini dan Bob tersedia di kode, tetapi tidak semua environment-nya diteruskan Compose lokal. Dukungan runtime tidak berarti provider langsung aktif pada paket ini.

Setelah memperbarui konfigurasi, jalankan kembali start agar environment dibaca ulang. Jangan reset data untuk mengganti model. Penggantian model tidak menggantikan validasi stok, sumber, atau persetujuan.

## Alamat layanan

| Layanan | Alamat lokal |
| --- | --- |
| Web SIGAP | http://localhost:8080 |
| Langflow | http://localhost:10000 |
| Gateway Auth/data | http://localhost:54321 |
| Inbox email latihan | http://localhost:8025 |

Database tidak memerlukan dashboard Supabase cloud untuk demo ini. Baca akun pada `.sigap-local-accounts.txt`; jangan menyalin kata sandinya ke README atau rekaman publik.

## Perintah lain

| Keperluan | Windows PowerShell | Linux |
| --- | --- | --- |
| Status | `.\start-sigap.ps1 status` | `bash ./start-sigap.sh status` |
| Periksa koneksi dan data lokal | `.\start-sigap.ps1 verify` | `bash ./start-sigap.sh verify` |
| Hentikan, simpan data | `.\start-sigap.ps1 stop` | `bash ./start-sigap.sh stop` |
| Hapus seluruh data demo lokal | `.\start-sigap.ps1 reset -ConfirmLocalReset` | `bash ./start-sigap.sh reset --confirm-local-reset` |
| Jalankan konfigurasi cloud yang ada | `.\start-sigap.ps1 cloud` | `bash ./start-sigap.sh cloud` |

Reset hanya untuk proyek Docker `sigap-local` dan menghapus data lokalnya secara permanen. File akun dan pengaturan tetap ada; jalankan start untuk membuat data contoh baru menggunakan akun tersebut. Mode cloud memakai konfigurasi cloud proyek yang sudah ada dan dijalankan secara terpisah.

## Batasan dan pemulihan

- Database dan autentikasi lokal dapat bekerja tanpa Supabase cloud selama Docker dan jaringan lokal komputer tersedia. Fitur AI watsonx tetap membutuhkan akses internet dan kredensial yang valid. Mode offline di browser tetap memiliki batasannya sendiri; paket ini tidak menjadikan model AI berjalan secara offline.
- Backup volume Docker secara berkala sebelum pembaruan atau pemindahan komputer. Simpan juga file konfigurasi lokal secara aman karena berisi kunci yang diperlukan instalasi tersebut. Backup ini terpisah dari backup Supabase cloud.
- Jika layanan gagal mulai, periksa Docker, ruang disk, koneksi unduhan awal, dan apakah port 8080, 54321, 8025, atau 10000 sudah digunakan. Periksa status dengan perintah di atas. Jika klasifikasi gagal menghubungi IBM IAM, pastikan jaringan dan DNS dapat menjangkau `iam.cloud.ibm.com` serta URL regional watsonx. Jangan kirim isi file konfigurasi atau kata sandi saat meminta bantuan.
- Skema awal dibekukan di `schema-baseline.sql`; migrasi baru yang lebih baru dari baseline diterapkan satu kali dan diperiksa perubahannya. File baseline dan migrasi yang sudah terpasang tidak boleh diubah untuk instalasi yang sudah berisi data.
- Email latihan ditangkap oleh Mailpit lokal, bukan dikirim sebagai email sungguhan. Keamanan dan pengaturan paket ini ditujukan untuk demo di satu komputer, bukan pemasangan produksi yang terbuka ke internet.

## Jika demo tidak berjalan

| Gejala | Pemeriksaan |
| --- | --- |
| Web tidak dapat dibuka | Jalankan `status`; pastikan seluruh stack aktif, bukan hanya frontend |
| Nginx gagal menemukan `backend` | Nyalakan stack lengkap dengan perintah start; frontend memerlukan jaringan/backend internal |
| Login gagal | Periksa Auth, gateway lokal, origin, serta akun latihan; jangan mencampur akun cloud/lokal |
| MCP belum siap | Tunggu Langflow sehat dan periksa konfigurasi MCP; health backend saja belum membuktikan flow berjalan |
| Model tidak dapat dihubungi | Periksa provider, endpoint, kredensial, DNS, dan akses jaringan model yang dipilih |
| Koreksi belum tersimpan | Periksa kandidat, konflik, persetujuan, dan hasil baca ulang sebelum mencoba lagi |
| Offline gagal setelah reload | Persiapkan halaman saat online pada origin/profil browser yang sama dan tunggu cache antarmuka siap |

Jangan menghapus volume untuk mengatasi masalah koneksi. Reset hanya dipakai jika ingin membuang data lokal.
