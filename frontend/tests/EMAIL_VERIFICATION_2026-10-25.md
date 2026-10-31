# Perbaikan pengembalian verifikasi email

- Supabase Site URL dikonfigurasi pengguna menjadi `http://localhost:5173`. Probe dengan token sengaja tidak valid mengembalikan HTTP 303 ke origin tersebut, tanpa memakai token pengguna atau mengirim email.
- Backend memakai `SIGAP_AUTH_REDIRECT_URL` (default `http://localhost:5173/`) untuk signup dan pengiriman ulang. URL ini juga perlu terdaftar pada URL Configuration Supabase. Input pengguna tidak dapat mengganti alamat pengembalian.
- Tombol **Kirim ulang verifikasi** meminta email yang terdaftar, tanpa mewajibkan password dan tanpa memulai ulang pendaftaran. Pengiriman hanya berjalan setelah pengguna menekan tombol.
- Callback `otp_expired` menampilkan petunjuk pemulihan. Fragmen yang berisi token dibersihkan dari address bar dan tidak dipakai untuk memberikan akses. Pengguna tetap masuk melalui autentikasi backend.
- Batas pengiriman email Supabase tetap ditampilkan sebagai alasan kegagalan; aplikasi tidak melakukan pengiriman ulang otomatis atau mengabaikan verifikasi email.

Verifikasi: 20 tes backend Auth, 38 unit test frontend, dan 26 tes Playwright terarah (desktop/mobile) lolos. Build backend, frontend, dan Docker berhasil. Bundle Docker memuat tombol kirim ulang dan penanganan tautan kedaluwarsa. Endpoint publik diuji dengan email tidak valid (422), tanpa mengirim email nyata.

Tes eksplisit: `frontend/tests/verificationReturn.test.ts`, `frontend/tests/e2e/verificationReturn.spec.ts`, `frontend/tests/e2e/passwordPolicy.spec.ts`, dan `backend/tests/supabaseAuth.test.ts`.
