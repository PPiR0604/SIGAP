# SIGAP Workspace

Frontend React + TypeScript + Vite untuk petugas posko. Workspace kini terintegrasi dengan backend SIGAP via `/api/*` (REST + SSE) dan memiliki fallback otomatis ke mode demo jika backend belum berjalan.

```powershell
cd frontend
npm install
npm run dev
```

Buka http://127.0.0.1:5173. Pemeriksaan: `npm test` dan `npm run build`.

Tes browser tambahan tersedia di `tests/browser-review.mjs`. Jalankan frontend dan backend **mock** dengan database uji terpisah serta `SIGAP_SESSION_TOKEN=sigap-local-review-test`. Set `SIGAP_BROWSER_PACKAGES` ke direktori node_modules yang menyediakan Playwright; `SIGAP_BROWSER_EXECUTABLE` opsional untuk path Chrome/Chromium. Lalu jalankan `node tests/browser-review.mjs`. Tes memakai profil browser terpisah, menahan respons HTTP untuk menguji SSE yang lebih cepat, menguji penguncian saat commit dan memastikan respons 409 tidak menghapus kandidat.

## Interaksi yang tersedia

Navigasi hanya ada di satu tempat: tab di header (**Laporan**, **Rekap**, **Buletin**) ditambah indikator status koneksi. Tiap halaman satu kolom dan satu fokus: **Laporan** untuk kirim laporan dan melihat pratinjau, **Rekap** untuk memeriksa dan menyetujui, **Buletin** untuk membaca draf. Kotak chat hanya tampil di halaman Laporan. Tautan antarhalaman hanya muncul saat relevan (mis. tombol "Periksa" saat ada posko bermasalah).

- Tempel pesan atau unggah `.txt` UTF-8 hingga 200 KiB. Backend menyaring PII (NIK, nomor telepon, email, rekening) secara otomatis sebelum diproses.
- Integrasi live: status koneksi mendeteksi `/api/health`. Jika terhubung, percakapan dan aliran proses dialirkan melalui SSE.
- Masukkan token dari `backend/data/session-token.txt` pada dialog koneksi. SSE menggunakan fetch dengan header Bearer dan `Last-Event-ID` saat reconnect. Token tidak dimasukkan ke URL.
- Rekap dari server menggunakan kandidat kanonis, ID laporan, dan usulan clear aktual. Angka kebutuhan hanya ditampilkan setelah hasil kalkulasi server diterima; data demo tidak dicampur dengan rekap server.
- Cari posko/desa, filter status, buka detail dan sumber laporan.
- Tinjau konflik data (mis. 45+55 != 98), kebutuhan air Sphere (15 L/orang/hari) dan draf buletin; salin draf atau unduh CSV.
- Persetujuan versi kandidat dengan konfirmasi rekap parsial dan keputusan pengosongan field (clear / keep / defer). Pada mode live, keputusan dicatat di backend SQLite dan diverifikasi sebelum penyimpanan.
- Backend mock menghasilkan pratinjau sintetis serta simulasi write/read-back, dengan label yang jelas dan tanpa klaim penyimpanan nyata.
- Layout desktop dan mobile, dialog native dan informasi status koneksi.

Jalur utama: Web → Backend SIGAP (Fastify) → Gemini API + MCP → Langflow. Provider Bob/ACP dan mock dapat dipilih pada backend. UI membedakan Gemini dikonfigurasi/belum siap dari backend mock; status health bukan bukti end-to-end. Key Gemini disimpan di backend/data/gemini.local.json, bukan token dialog frontend. Dialog frontend tetap memakai Bearer token lokal backend.

Tes tambahan `tests/browser-gemini-status.mjs` memeriksa label dan ketiadaan kandidat palsu pada backend Gemini dengan GEMINI_API_KEY kosong. Gunakan konfigurasi Playwright yang sama dengan tes browser mock. Restart backend setelah key/model diubah.

`src/demo.ts` menyimpan fixture, `src/review.ts` validasi demo, `src/App.tsx` interaksi, dan `src/styles.css` tampilan (satu stylesheet, token warna dan skala tipografi di `:root`) dan `src/chatDock.css` panel chat. Reload menghapus riwayat sesi. Font DM Sans dimuat dari Google Fonts dengan fallback Segoe UI.
