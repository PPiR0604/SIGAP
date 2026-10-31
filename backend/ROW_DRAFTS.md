# Klarifikasi dan draf per posko

Implementasi mempertahankan Supabase sebagai penyimpanan resmi dan Langflow sebagai pelaksana validasi, perhitungan, serta write melalui MCP.

## Perilaku

- Kolom formulir yang berubah dikirim sebagai `correction` terstruktur. Backend memvalidasi schema, mengikat target, membandingkan fingerprint data awal, dan membuat sumber berlabel untuk validator Langflow. Jika kolom berubah tanpa catatan bebas, prepare dan validate dipanggil langsung tanpa model. Catatan bebas, laporan WhatsApp, CSV dan pertanyaan percakapan masih memakai jalur AI.
- Hasil tool untuk model diringkas: referensi snapshot, angka, kebutuhan, stok dan periode, masalah validasi tetap tersedia. Provenance dan riwayat yang besar tetap disimpan server dan dikirim lengkap ke UI, tetapi tidak diulang ke model.
- Langflow membuat snapshot immutable untuk setiap posko pada hasil multi-posko. Backend membuat batch tinjauan tersendiri untuk setiap snapshot. Parent diberi status `split_for_review` dan tidak dapat disetujui sebagai batch gabungan. Kandidat lama tetap dapat memakai jalur kompatibilitas dengan verifikasi hash; jika tidak kompatibel, pengguna diminta memvalidasi ulang.
- Draf memakai penyimpanan snapshot/batch yang sudah ada, dengan referensi persetujuan, masa berlaku 24 jam, dan pemeriksaan izin sesi. Tidak ada tabel sementara di browser sebagai sumber kebenaran.
- Browser meminta resume sesi terakhir milik akun dan ruang kerja yang sama. Endpoint recovery memuat rekap resmi, kandidat yang masih berlaku, hasil hitung, dan cursor SSE. Event persetujuan lama tidak diputar ulang. Proses yang terputus ketika backend restart tidak diulang otomatis: statusnya menjadi failed atau save_status_unknown saat resume.
- Persetujuan tetap eksplisit. Sesudah persetujuan, backend memanggil writer MCP dengan payload keputusan persis dan reader dengan receipt efektif; tidak ada panggilan model pada fase commit. Izin dikonsumsi sekali, sehingga write tidak diulang ketika hasil jaringan tidak pasti.
- Posko baru memperoleh `shelter_id` dari kode penyimpanan, bukan model. ID lama dipertahankan. Data lama tanpa ID memperoleh ID ketika koreksi yang terikat ke baris asal disetujui. Tidak ada migrasi massal yang mengganti isi data lama. Pencocokan lama tetap tersedia untuk data yang belum mendapat ID.
- Penyimpanan resmi masih berupa dokumen per ruang kerja pada tahap ini. Pembaruan hanya menerapkan baris yang disetujui, memeriksa baseline baris, dan memakai CAS revisi dokumen. Perubahan bersamaan ditolak untuk ditinjau ulang; tidak digabung atau ditimpa diam-diam. Normalisasi tabel resmi menjadi satu baris per posko merupakan tahap migrasi berikutnya.

## Kontrak formulir

`POST /api/sessions/:id/messages` tetap menerima teks biasa. Tambahan opsional:

```json
{
  "request_id": "id-permintaan",
  "text": "Teks untuk riwayat percakapan",
  "correction": {
    "target": {"report_id":"R002","batch_id":"referensi-sumber","name":"Posko Harapan","village":"Sukamaju"},
    "base_key": "fingerprint data sumber formulir",
    "changes": {"elderly":14}
  }
}
```

Backend membentuk ulang sumber dari field yang diterima; teks browser tidak menentukan isi ekstraksi terstruktur. Field yang tidak diizinkan ditolak. Untuk mengosongkan nilai atau menafsirkan catatan bebas tetap gunakan alur klarifikasi bahasa alami dan keputusan clear/keep yang sudah ada.

## Pengukuran

Log `LLM usage` memuat durasi panggilan model, ukuran konteks dan token. Log `Workflow stage selesai` memuat nama tool dan durasi eksekusinya tanpa isi laporan/token akses. Pengujian membuktikan nol panggilan model pada jalur terstruktur dan commit; ini bukan janji durasi respons hosted karena jaringan, Langflow dan database tetap berpengaruh.

## Verifikasi

Backend: schema formulir, fingerprint, pemisahan kandidat, gerbang izin, payload write persis, receipt, idempotensi, pemulihan sesi, dan isolasi antar-akun. Python: sumber → validator → kandidat tanpa LLM, ID stabil, stok nol/unknown, konflik, gate/writer dan snapshot per posko termasuk stok desimal. Playwright desktop/ponsel: edit A → B → A, persetujuan terpisah, draft chat tetap ada, reload memulihkan dua draf, dan formulir angka mengirim perubahan terstruktur.

Pengujian memakai fixture terpisah; tidak menyetujui laporan peserta atau mempublikasikan buletin. Konfigurasi runtime yang aktif tetap provider OpenAI-compatible. Perubahan ini tidak mengklaim adapter autentikasi IBM Bob sudah tersedia.
