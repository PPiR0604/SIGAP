# Rekap SQLite dan impor CSV — 22 Oktober 2026

Langflow adalah satu-satunya pemilik database rekap. Web/backend meminta baca/tulis lewat flow MCP; tidak membuka file SQLite atau menerima SQL dari LLM. SQLite metadata sesi/persetujuan pada backend tetap terpisah.

## Lokasi dan kontrak

- Default rekap: `output/rekap_posko.sqlite3` relatif ke working directory **Langflow**.
- Pilih path absolut yang sama pada field **Database Rekap SQLite** di reader (`fetch_shelters`), writer (`upsert_shelter`), dan validator (`validate_needs`, termasuk validator di `prepare_needs` jika ada). Alternatif: `SIGAP_SHELTER_DB_PATH` pada environment proses Langflow.
- Jika Langflow di container, pasang volume persisten dan gunakan path di dalam container yang sama untuk seluruh flow. Backend tidak membutuhkan mount database rekap.
- Pada upgrade lokal sesi ini, flow aktif dipasangkan ke `C:/FIle/Dev/Projek Hackation IBM/output/rekap_posko.sqlite3`.

`shelters` menyimpan identitas posko, baris agregat sesuai schema dan versi; `shelter_history` menyimpan nilai sebelum/sesudah; `storage_commits` menyimpan receipt idempoten. Header disimpan dalam `storage_meta` agar metadata/provenance JSON lama dapat dipertahankan. Nilai detail tetap mengikuti kontrak kanonis validator, bukan schema bebas buatan model.

Satu `BEGIN IMMEDIATE` mencakup semua baris, versi, riwayat dan receipt. Gagal satu baris membatalkan seluruh batch. Writer memeriksa baseline yang dilihat pada pratinjau di dalam transaksi; perubahan dari sesi lain memerlukan validasi dan persetujuan baru. Snapshot juga terikat lokasi sumber SQLite. Tidak ada fallback write otomatis ke Sheets/CSV.

Perbaikan 22 Oktober: pencocokan `update_target.expected` pada SQLite memakai header baris tersimpan termasuk `versi` dan `disimpan_di`. Sebelumnya kolom versi yang sah dianggap hilang karena header input writer belum memuat metadata tersebut. Identitas, baseline, penolakan target usang, dan transaksi tetap diperiksa. Read-back juga menormalisasi nilai kosong di kedua sisi perbandingan agar kolom opsional kosong tidak menghasilkan mismatch palsu. Kandidat yang write-nya sudah ditolak perlu dibaca/ditinjau kembali dan memperoleh persetujuan baru; jangan memutar ulang persetujuan yang telah dikonsumsi.

## Impor melalui web

1. Unggah `.csv` atau `.txt`, periksa isi, kemudian klik Kirim. Template: `data/synthetic/template-impor-posko.csv`.
2. Server mem-parsing CSV tanpa mengeksekusi formula. Header umum dipetakan ke label sumber; baris diberi batas dan rujukan nomor baris. Sel tetap data tak tepercaya. Maksimal 200 KiB, 100 baris, 64 kolom; normalisasi yang melebihi batas ditolak.
3. LLM mengusulkan ekstraksi; validator tetap memeriksa angka terhadap sumber. Kolom yang ambigu memerlukan klarifikasi. Tidak ada asumsi kolom kosong berarti nol atau penghapusan.
4. Jumlah record hasil ekstraksi harus mencakup seluruh baris CSV; impor parsial diam-diam ditolak. Validator menggabungkan laporan per posko dan membandingkan nilai dengan SQLite. Laporan WhatsApp melewati pemeriksaan yang sama.
5. Pada dialog persetujuan, pilih **nilai tersimpan** atau **nilai laporan baru** untuk setiap konflik, lalu berikan persetujuan. Pilihan tidak dapat ditukar model setelah disetujui. Pilihan angka yang menghasilkan total laki-laki/perempuan tidak konsisten ditolak dan perlu ditinjau ulang.
6. Langflow menulis, menerbitkan referensi efektif, melakukan read-back, dan backend menghitung kebutuhan dari snapshot tersimpan. Pratinjau sebelum persetujuan dapat berbeda dari hasil akhir bila petugas memilih nilai lama.

Ekspor CSV tetap tersedia dari Rekap. Sel teks yang berpotensi menjadi formula spreadsheet diberi prefix teks. Impor tidak membuka akses publik atau mengubah pengamanan login aplikasi.

## Migrasi awal data yang sudah ada

Migrator administratif hanya menerima CSV rekap kanonis SIGAP. CSV dengan header bebas milik peserta harus masuk lewat pratinjau web di atas. Migrator menjaga file sumber, menolak duplikasi identitas dan schema/angka invalid, serta hanya mengisi database kosong. Baris historis dengan desa belum diketahui tetap dipertahankan menggunakan identitas internal legacy; desa tidak dikarang. Baris tersebut perlu klarifikasi sebelum penambahan baru yang tidak memiliki target pasti.

Jalankan dari root repositori:

```powershell
python langflow/scripts/migrate_csv_sqlite.py --csv path/rekap_posko.csv --database output/rekap_posko.sqlite3
python langflow/scripts/migrate_csv_sqlite.py --csv path/rekap_posko.csv --database output/rekap_posko.sqlite3 --apply
```

Perintah pertama hanya memeriksa/pratinjau. Perintah kedua adalah penerapan eksplisit. Migrasi yang sama dapat diulang tanpa menggandakan baris. Versi/disimpan_di yang tidak ada pada sumber ditambahkan sebagai metadata migrasi.

Untuk sumber Sheets aktif, skrip `backend/scripts/inspect-storage-migration.ts` mencadangkan read-back kanonis dari MCP tanpa mengubah Sheets. `readback_to_csv.py` membuat adaptor CSV untuk migrator, sementara JSON asli tetap disimpan sebagai cadangan lengkap. Pada upgrade lokal ini **9 posko** dipindahkan; pembacaan MCP SQLite dibandingkan per field dengan sumber awal dan tidak menemukan perbedaan. Sheets asli tetap utuh.

## Pembaruan flow dan rollback

```powershell
python langflow/scripts/sync_storage_flows.py
cd backend
node --import tsx scripts/deploy-sqlite-storage.ts
node --import tsx scripts/deploy-sqlite-storage.ts --apply
```

Generator menyematkan sumber `components/` serta `lib/sigap_contracts.py` dan `lib/sigap_sqlite.py` ke JSON. Flow tidak perlu mengimpor paket Python lokal tambahan. Skrip deploy hanya mengizinkan Langflow localhost, mempertahankan ID/topologi/kredensial, dan menyimpan salinan rollback per flow sebelum perubahan pertama. Jalankan pada jendela pemeliharaan tanpa pengguna aktif. Flow reader diaktifkan terakhir; kegagalan patch memicu rollback flow yang sudah diubah.

Cadangan lokal berada di `output/testing/storage-migration/`: `source-readback.json`, `source-rekap.csv`, `rollback/*.json` dan ringkasan deployment. Folder diabaikan Git dan dapat memuat data/kredensial konfigurasi; jangan dipublikasikan. Untuk rollback, pulihkan `data` flow dari salinan awal melalui API Langflow atau import UI dengan pemeriksaan ID/MCP, lalu restart sesi aplikasi. Database SQLite tidak perlu dihapus; sumber Sheets asli tidak diubah. Setelah ada write baru ke SQLite, cadangan Sheets lama tidak otomatis mutakhir: ekspor dan rekonsiliasi perubahan sebelum rollback.

Backup harian SQLite yang aktif sebaiknya memakai SQLite backup API atau hentikan penulis terlebih dahulu; jangan menyalin file utama sambil mengabaikan WAL. Penghapusan metadata sesi backend tidak menghapus rekap/history; kebijakan retensi rekap perlu ditentukan terpisah sebelum data nyata dipakai.

## Pemeriksaan yang dapat diulang

```powershell
python -m unittest discover -s langflow/tests -v
cd backend
npm test
npm run build
node --import tsx scripts/sqlite-flow-probe.ts
cd ../frontend
npm test
npm run build
npm run test:e2e
npm run test:e2e:live
```

Probe SQLite memakai flow Langflow nyata dengan override path **per run** ke database uji terpisah. Ia memeriksa penolakan tanpa persetujuan, konflik tanpa keputusan, pilihan keep/incoming, read-back verified dan kandidat usang, tanpa menulis rekap operasional. Unit Python memakai stub antarmuka Langflow, sedangkan validator, gate, snapshot dan SQLite dijalankan tanpa modifikasi. Suite browser mock memeriksa interaksi; suite live memanggil Gemini/Langflow dan tetap memblokir writer/publikasi.

Impor CSV live dua desa berhasil pada 22 Oktober. Pengulangan skenario koreksi live mengalami kegagalan/timeout provider Gemini dan tetap dicatat sebagai kegagalan; keberhasilan flow SQLite langsung tidak menggantikan bukti end-to-end model tersebut.

Hasil pemeriksaan lokal akhir: **140 tes backend**, **24 unit frontend**, **56 tes browser desktop/mobile** (30,2 detik), **5 tes integrasi Python** lulus, serta build frontend/backend berhasil. Probe flow SQLite nyata mengonfirmasi keep/incoming, read-back verified, dan penolakan baseline usang di database terisolasi. Probe koreksi MCP tanpa model mempertahankan dua desa dan kebutuhan desa lain. Artefak kegagalan live koreksi disimpan di `output/testing/storage-migration/live-correction-failure.json`; keberhasilan impor CSV live tercatat pada eksekusi suite pertama, sedangkan pengulangan khusus koreksi tetap gagal.

Frontend/backend kini dijalankan melalui Docker di `http://127.0.0.1:5173` / `http://127.0.0.1:8787` (Gemini live terkonfigurasi); proses Node Windows dari pengujian sebelumnya sudah dihentikan. Metadata backend dipindahkan ke volume Linux `sigap_backend_state` setelah backup dan pemeriksaan integritas, untuk menghindari akses SQLite WAL bersamaan lintas Windows–Linux. Database rekap Langflow tetap terpisah dan pemeriksaan MCP dari container berhasil membaca 9 posko. Lihat [konfigurasi Docker backend](../backend/README.md#docker-desktop).
