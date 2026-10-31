# Komando, anggota, dan ruang operasi SIGAP

Implementasi ini khusus backend. Deployment Vercel serta integrasi frontend tetap ditunda.

## Model data dan batas akses

Satu `organization_id` mewakili satu komando/instansi yang datanya dikelola bersama. Komando boleh mempunyai beberapa admin. `context_id` adalah ruang operasi, misalnya `banjir-oktober`, yang dapat memuat beberapa posko pengungsian. Data kanonis, snapshot, sesi dan publikasi tetap mengikuti organisasi dan ruang operasinya.

Untuk tahap ini, satu instalasi backend melayani komando dalam `SIGAP_ORGANIZATION_ID`; satu akun tergabung ke satu komando. Tidak ada pembuatan komando otomatis saat registrasi, perpindahan komando otomatis, atau pemilihan organisasi lewat body permintaan. Fondasi data dapat menampung komando lain, tetapi pengelolaan banyak komando dalam satu instalasi belum diaktifkan.

| Role | Hak akses |
|---|---|
| admin | Seluruh ruang operasi dalam komandonya, anggota, undangan, penugasan, audit dan persetujuan publikasi |
| petugas | Ruang operasi yang ditugaskan dan sesi sendiri; konfirmasi manusia tetap diperlukan sebelum menyimpan perubahan laporan |
| viewer | Publikasi yang telah disetujui dalam komandonya; tidak mengakses laporan mentah atau menjalankan model |

`GET /api/admin/users` sekarang hanya menampilkan anggota komando tersebut. Akun pending global tidak dapat dilihat atau diambil alih melalui endpoint perubahan anggota. Calon anggota harus mengajukan permintaan ke komando atau menerima undangan terlebih dahulu.

## Alur bergabung

1. Pengguna registrasi, lalu langsung login dengan email dan kata sandi melalui Supabase Auth. Confirm email di Authentication → Sign In / Providers → Email harus nonaktif; Supabase mengonfirmasi akun baru secara otomatis. Registrasi tetap menghasilkan profil `pending` tanpa role atau organisasi.
2. `GET /api/auth/command` memberikan ID dan nama komando instalasi ini kepada pengguna yang sudah login, termasuk akun pending.
3. Pilih salah satu jalur berikut:
   - Permintaan: pengguna `POST /api/auth/join-requests` dengan `{ "note": "Relawan penanganan banjir" }`. Admin membaca `/api/admin/join-requests`, lalu menyetujui role dan scopes secara eksplisit atau menolak.
   - Undangan: admin membuat undangan untuk email, role dan scopes tertentu. Pengguna yang sudah login menerima token melalui `POST /api/auth/invitations/accept`.
4. Pengguna membaca ulang `/api/auth/me` untuk mendapatkan status dan penugasan terbaru. Status dan penugasan dibaca dari database pada setiap request; isi metadata pengguna tidak menetapkan role.

Permintaan bergabung tidak memberikan akses operasional sampai disetujui. Satu permintaan pending per akun/komando diperbarui ketika dikirim ulang. Setelah ditolak, pengguna dapat mengajukan kembali. Akun disabled atau anggota yang sudah tergabung tidak dapat menggunakan jalur ini untuk aktif kembali atau berpindah komando.

## API backend

Semua endpoint berikut membutuhkan `Authorization: Bearer <Supabase access_token>`. Endpoint admin memerlukan admin aktif dalam komando instalasi ini. Respons menggunakan `Cache-Control: no-store`.

| Method | Path | Body / hasil |
|---|---|---|
| GET | `/api/auth/command` | `{id,name}` komando instalasi |
| POST | `/api/auth/join-requests` | `{note?}`; menghasilkan permintaan pending, HTTP 202 |
| GET | `/api/auth/join-requests` | Riwayat permintaan pengguna sendiri untuk komando ini |
| POST | `/api/auth/invitations/accept` | `{token}`; role dan scopes diambil dari undangan tersimpan |
| GET | `/api/admin/command` | Identitas komando admin |
| PATCH | `/api/admin/command` | `{name}`; mengganti nama, bukan ID/batas organisasi |
| GET | `/api/admin/join-requests` | Permintaan pending yang ditujukan ke komando admin |
| POST | `/api/admin/join-requests/:id/decision` | `{decision:"approve",role:"petugas",scopes:["banjir-oktober"]}` atau `{decision:"reject"}` |
| POST | `/api/admin/invitations` | `{email,role,scopes,expires_in_hours?}`; default 24 jam, maksimum 168 jam |
| GET | `/api/admin/invitations` | Metadata undangan komando, tanpa token atau hash token |
| DELETE | `/api/admin/invitations/:id` | Mencabut undangan yang belum digunakan; HTTP 204 |
| POST | `/api/admin/operations` | `{context_id,name,description?}`; membuat ruang operasi baru, tidak menimpa ID yang sudah ada |
| PATCH | `/api/admin/operations/:id` | `{name,description?}`; memperbarui ruang operasi komando sendiri |
| GET | `/api/contexts` | Ruang operasi yang dapat diakses admin/petugas |
| GET | `/api/contexts/:id` | Detail ruang operasi setelah pemeriksaan penugasan |
| POST | `/api/sessions` | `{context_id}`; membuka sesi dalam ruang operasi yang dipilih |

Pemilihan ruang operasi mengikuti request/sesi, bukan pilihan global di akun. Membuka tab/perangkat lain tidak memindahkan sesi yang sedang berjalan. `posko-default` lama tetap tersedia; klien baru sebaiknya mengirim `context_id` secara eksplisit. Endpoint lama `/api/admin/contexts` tetap kompatibel untuk pembuatan/perubahan nama.

Undangan menghasilkan token acak 256 bit yang hanya dikembalikan sekali kepada admin. Admin membagikannya sendiri; backend tidak mengirim email. Database menyimpan SHA-256 token. Penerimaan memerlukan email Supabase yang sudah terverifikasi dan sama dengan email tujuan, undangan yang belum dipakai/dicabut/kedaluwarsa, serta pembuat yang masih admin aktif. Token dikirim dalam JSON body, bukan query URL. Mengundang anggota aktif tidak mengubah role-nya; perubahan anggota yang sudah tergabung tetap melalui `/api/admin/users/:id`.

Field tambahan seperti `actor_id`, `organization_id`, atau role pada penerimaan undangan ditolak. Penolakan operasi gateway menghasilkan `403 OPERATION_REJECTED` tanpa membocorkan SQL, email pengguna lain, atau token. Perubahan komando, undangan, permintaan anggota dan ruang operasi tercatat di audit tanpa isi token/hash.

## Skema dan verifikasi

- Instalasi baru: `supabase/schema.sql` sudah memuat seluruh fitur.
- Instalasi lama: terapkan `supabase/command-workspaces.sql` **sekali** sebagai migrasi `command_membership_and_operation_workspaces`; jangan menjalankan ulang skema awal terhadap database yang sudah berisi data.
- Tabel baru `sigap_join_requests` dan `sigap_invitations` memakai RLS dan tidak memiliki akses langsung untuk `anon`/`authenticated`. RPC tetap `SECURITY INVOKER`, hanya untuk `service_role` melalui gateway bertanda tangan.
- Penerimaan undangan dan persetujuan anggota berlangsung dalam transaksi dengan penguncian organisasi/profil. Validasi scope, perubahan anggota, konsumsi undangan dan audit menjadi satu operasi atomik.

Migrasi sudah diterapkan pada proyek Supabase yang dikonfirmasi (`tdhbhasewgdhczcwogqq`). Komando SIGAP dan ruang operasi `posko-default` dipertahankan. Sebanyak 1.873 entitas lama serta dokumen data kanonis memiliki hash yang sama sebelum/sesudah migrasi; tidak dibuat akun Auth atau undangan uji di Supabase. Pemeriksaan keamanan Supabase tidak menghasilkan temuan.

Verifikasi lokal: TypeScript build dan 166 tes backend lulus. `supabase/access-tests.sql` dan `supabase/command-access-tests.sql` lulus pada PostgreSQL sementara (PGlite), baik melalui skema baru maupun jalur upgrade. Uji mencakup isolasi dua komando, penugasan, verifikasi email, persetujuan, token sekali pakai, kedaluwarsa, pencabutan, RLS dan audit. Fixture Auth hanya digunakan pada database sementara, bukan Supabase produksi. Pengujian HTTP fixture memerlukan akses loopback di luar sandbox jaringan.

Uji integrasi lokal API → pemeriksaan Auth/session → PostgreSQL juga lulus: admin membuat operasi, petugas mengajukan dan mendapat persetujuan bergabung, petugas memilih operasi dan membuat sesi, viewer menerima undangan, pemakaian ulang token ditolak, dan viewer tidak dapat membaca data mentah. Identitas Auth digantikan fixture lokal; hasil ini tidak membuktikan pengiriman email verifikasi Supabase.

Untuk mengulang uji pada PostgreSQL kosong yang dapat dibuang, jalankan berurutan dengan `psql -v ON_ERROR_STOP=1 -f`: `supabase/test-bootstrap.sql`, `supabase/schema.sql`, `supabase/access-tests.sql`, dan `supabase/command-access-tests.sql`. Jangan menjalankan bootstrap/fixture Auth pada proyek Supabase. Jalur upgrade diuji dengan skema sebelum perubahan, kemudian `supabase/command-workspaces.sql`, lalu kedua file pengujian.

Login/email nyata dan UI anggota belum diuji end-to-end. Admin pertama tetap harus registrasi dan verifikasi menggunakan email installer yang sudah disetujui; tidak ada jalan pintas untuk mengaktifkan admin dari permintaan registrasi.


## Pendaftaran tanpa verifikasi email

Pendaftaran tidak mengirim tautan konfirmasi setelah Confirm email dinonaktifkan. Endpoint kirim ulang verifikasi dihapus. Frontend menampilkan langkah daftar → masuk → minta akses admin; role dan penugasan tetap diperiksa backend. Jika penyedia masih meminta konfirmasi, API mengembalikan kesalahan konfigurasi dan tidak mengklaim pendaftaran tanpa email berhasil. Pemulihan kata sandi yang dipilih pengguna tetap menggunakan email dan dapat terkena batas pengiriman tersendiri.
