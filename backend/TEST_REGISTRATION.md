# Pendaftaran untuk pengujian SIGAP

Selama mode pengujian aktif, setiap akun Auth baru non-anonim otomatis mendapat role `petugas`, satu pos komando latihan, dan salinan baseline sintetis **8 posko / 630 jiwa** sesuai `data/synthetic/user-validation/sesi-manual/PANDUAN-PESERTA.md`. Setiap akun memiliki scope dan salinan rekap yang berbeda. Admin organisasi tetap dapat melihat ruang-ruang tersebut. Data baru tetap memerlukan persetujuan sebelum disimpan. Rekap awal dibaca saat peserta mengirim pesan pertama atau menggunakan tombol **Cek rekap tersimpan**.

Baseline memakai tanggal 25 Oktober 2026 seperti berkas input panduan. Jika tanggal skenario diubah, perbarui baseline dan seluruh input secara konsisten, lalu perbarui payload di `supabase/test-registration.sql` menggunakan `storage_payload()` pada `langflow/scripts/prepare_user_testing.py` sebelum menerapkannya. Perubahan seed hanya berlaku untuk akun yang mendaftar setelahnya; rekap peserta yang sudah ada tidak ditimpa.

Pendaftaran dan pembuatan ruang latihan berada dalam satu transaksi database. Apabila pembuatan ruang gagal, pendaftaran juga gagal. Tidak ada perubahan pada akun yang sudah ada. Untuk menghentikan pembuatan ruang bagi akun baru setelah sesi validasi, jalankan sebagai pengelola database:

```sql
update sigap_private.test_registration_settings set enabled = false where id = true;
```

Akun dan ruang latihan yang sudah dibuat tetap ada. Nonaktifkan pendaftaran otomatis dan sesuaikan teks panduan pendaftaran frontend sebelum menggunakan sistem untuk operasional. Untuk mengaktifkannya kembali, ubah `enabled` menjadi `true`. Konfigurasi hanya dapat diubah oleh pengelola database, bukan pengguna biasa.

Pengujian SQL di `supabase/test-registration-tests.sql` hanya boleh dijalankan di database PostgreSQL sementara setelah `test-bootstrap.sql` dan `schema.sql`; jangan menjalankan fixture di proyek Supabase aktif. Pengujian antarmuka tersedia di `frontend/tests/e2e/testRegistration.spec.ts` dan memakai respons tiruan.
