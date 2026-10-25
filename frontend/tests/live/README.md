# Pengujian Langflow nyata

**Pembaruan 22 Oktober 2026:** sumber aktif telah dimigrasikan ke SQLite (9 posko, nilai sumber tetap sama). Skenario baru impor CSV dua desa berhasil melalui Gemini/Langflow dan menghitung 150/300 L/hari tanpa write. Pengulangan skenario koreksi lama gagal pada provider Gemini, termasuk timeout; hasil tersebut tidak dihitung lolos. Ringkasan kegagalan tersimpan di `output/testing/storage-migration/live-correction-failure.json`. Uji flow SQLite langsung dengan database terisolasi lolos untuk keep/incoming, penolakan tanpa persetujuan, read-back verified dan baseline usang. Lihat [panduan dan hasil migrasi](../../../langflow/SQLITE_MIGRATION.md); tabel 21 Oktober di bawah adalah catatan historis.

Suite terpisah ini menggunakan **Gemini API dan Langflow MCP nyata**. `langflow.spec.ts` adalah file tes Playwright eksplisit. Jalankan dari `frontend` setelah Langflow aktif dan konfigurasi `.env` / `backend/data/` terisi:

```powershell
npm run test:e2e:live
```

Server uji otomatis memakai frontend **5184**, backend **8798**, SQLite **memori**, dan token khusus tes. Port harus kosong. Konfigurasi live tidak mengganti `.env` atau database aplikasi. Input baru adalah satu laporan sintetis; pembacaan awal memakai flow `fetch_shelters` yang sudah dikonfigurasi. Kandidat/sumber sementara dibuat oleh Langflow di penyimpanan snapshotnya seperti eksekusi normal.

Writer diblokir di wrapper runtime, dan draf tidak boleh membuat dokumen. Suite memeriksa bahwa klik konfirmasi tanpa checkbox tidak mengirim request keputusan. Tidak menguji penulisan CSV/Sheets, read-back sesudah write, publikasi Docs, atau IBM Bob; provider aktif yang diuji adalah Gemini. Panggilan API model dapat memakai kuota akun.

Skenario: bootstrap sesi live → kirim laporan 10 jiwa → kandidat dari validator Langflow → nama/angka tampil di rekap → persetujuan tanpa konfirmasi ditolak → koreksi langsung dari dialog (total 12, laki-laki 5, perempuan 7) → snapshot baru dan angka hasil validasi tampil tanpa pindah halaman → empat kebutuhan Sphere otomatis dihitung Langflow dan tampil di dialog yang sama, tanpa pesan hitung tambahan → permintaan semua desa mencakup rekap tersimpan dan kandidat baru. Status health saja tidak dianggap keberhasilan; tes mewajibkan snapshot, isi kandidat, dan hasil kalkulasi nyata.

Hasil HTML: `frontend/playwright-report-live/index.html`. JSON: `frontend/test-results-live/results.json`. Screenshot `live-rekap.png`, `live-klarifikasi.png`, dan `live-kebutuhan.png` berada di subfolder `test-results-live`. Attachment laporan memuat ringkasan status kandidat dan hasil kalkulasi, tanpa API key. Artefak hasil diabaikan Git.

## Hasil 21 Oktober 2026, sekitar 17.28 WIB

| Pemeriksaan | Hasil |
| --- | --- |
| MCP initialize dan tools/list | Lolos, 7 tool SIGAP terdeteksi |
| Eksekusi flow fetch_shelters | Lolos, 9 posko, status `ok` |
| Playwright live, web → Gemini → MCP → Langflow | **1 passed** (30,6 detik termasuk startup; skenario 25,6 detik) |
| Kandidat sintetis | 10 jiwa, 4 laki-laki, 6 perempuan, disabilitas 0 |
| Klarifikasi langsung dari dialog | Total 12, laki-laki 5, perempuan 7; snapshot baru; halaman tetap Rekap |
| Kalkulasi otomatis 12 jiwa | Air 180 L/hari; pangan 25.200 kkal/hari; jamban 1 unit; hunian 42 m²; tampil di dialog yang sama |
| HITL tanpa checkbox | Ditolak, 0 request keputusan penyimpanan |
| JavaScript page errors | 0 |
| Giliran koreksi/kalkulasi selesai | `ready_for_review`; ID/hash snapshot kalkulasi sama dengan kandidat; `automatic_recalculation=true` |
| Kebutuhan seluruh desa setelah klarifikasi | **10 posko**, rekap tersimpan + kandidat terbaru; `scope=all_shelters` |
| Regresi mock desktop/mobile | **52 passed**, 0 skipped, 0 flaky (26,7 detik) |
| Pemeriksaan tipe backend | `npm run build` lolos |
| Frontend | 23 unit test lolos; build berhasil |
| Backend | 135 tes lolos |

Probe eksplisit ada di `backend/scripts/langflow-live-probe.ts`, dijalankan dari `backend` dengan `node --import tsx scripts/langflow-live-probe.ts`. Hasil ringkas tanpa isi rekap berada di `output/testing/langflow-live-probe.json`. Probe memakai loader konfigurasi aplikasi sehingga mengikuti `LANGFLOW_MCP_URL`/`LANGFLOW_API_KEY`, dengan fallback konfigurasi lokal; tidak mencetak key.

Pada pemeriksaan awal, `/` di port Langflow 7860 mengembalikan 404, tetapi endpoint MCP valid dan flow berhasil. Port web operasional 5173/8787 belum aktif, sehingga verifikasi menggunakan server uji terpisah. Lolosnya tes ini tidak membuktikan pengujian lewat UI Playground Langflow; eksekusi flow dilakukan melalui MCP nyata.

## Temuan saat implementasi klarifikasi

Format awal `laki-laki menjadi 3` tidak memenuhi pola bukti angka pada validator sumber, sehingga angka lama terbawa ke kandidat baru. Form kini mengirim `laki-laki: 3`, dengan pola label/angka yang dikenali validator. UI juga membandingkan angka yang diminta dengan kandidat: perbedaan menghasilkan pesan di dialog dan mempertahankan draf koreksi. Tidak ada pembaruan angka optimistis atau pengubahan validator agar menerima angka tanpa bukti.

Satu pengulangan tambahan berhenti pada `needs_review` sebelum mencapai form klarifikasi: Gemini mencetak JSON ekstraksi sebagai jawaban, tanpa memanggil tool validator. Bukti kegagalan disimpan di `output/testing/live-incomplete-20261021.json` dan `.zip`; ini menunjukkan variasi eksekusi model yang masih mungkin terjadi. Tes kini berhenti segera pada status terminal tersebut dan tetap mewajibkan `ready_for_review`. Pengulangan terakhir pada kode final berhasil sampai koreksi dan kalkulasi, tanpa retry otomatis. Keberhasilan terakhir tidak berarti semua respons model akan selalu menyelesaikan workflow.

## Uji cakupan semua desa

Tes web menambahkan permintaan "Tolong periksa kebutuhan di semua desa, termasuk kandidat yang baru saya klarifikasi." setelah koreksi. Jawaban dan payload kalkulasi harus berisi lebih dari satu posko, referensi sumber tersimpan dan kandidat, serta jumlah baris rekap yang sama dengan hasil gabungan. Pada pengujian ini hasilnya 10 posko, bukan satu posko yang terakhir dikoreksi. Kalkulasi seluruh rekap kini dipanggil langsung oleh backend lewat MCP ke Langflow sehingga model tidak dapat mempersempit cakupannya ke audit koreksi.

Probe mandiri `backend/scripts/correction-scope-probe.ts` juga menjalankan prepare → validate → koreksi → validate → calculate lewat MCP nyata tanpa model: 2 desa sebelum dan sesudah koreksi, 1 record audit perubahan, dan 2 posko dalam kalkulasi. Desa yang tidak dikoreksi tetap identik, termasuk kebutuhan beras. Ringkasan ada di `output/testing/correction-scope-probe.json`. Semua eksekusi hanya membuat sumber/snapshot uji dan membaca data; writer tidak dipanggil.
# Pemeriksaan gangguan Gemini 503 (22 Oktober 2026)

Pengulangan skenario `web → Gemini` setelah penanganan 503 tetap gagal: provider mengembalikan 503 pada request awal dan satu retry. Backend menyampaikan `GEMINI_UNAVAILABLE`; keberhasilan klarifikasi nyata belum dapat dikonfirmasi pada run ini. Tes sintetis backend (142 tes) lulus, termasuk pemulihan satu 503, batas retry, pelestarian sesi/kandidat sebelumnya, dan larangan mengulang write. Pembacaan MCP dari container tetap berhasil untuk 9 posko. Log run: `output/testing/gemini-503-live.log`.

# DeepSeek melalui proxy lokal (22 Oktober 2026)

Server uji memilih `openai` atau `gemini` dari `SIGAP_AGENT_PROVIDER`; konfigurasi OpenAI dibaca dari file lokal backend. Pada penggantian ke `oc/deepseek-v4.1-flash-free`, skenario browser laporan → validasi → klarifikasi 10 ke 12 jiwa → kalkulasi 180 L/hari → kebutuhan seluruh desa **lulus** dalam 41,8 detik. Writer dan publikasi tetap diblokir pada server uji. Log: `output/testing/deepseek-live.log`.

Verifikasi tambahan: 145 tes backend, 25 unit frontend dan 60 tes browser desktop/mobile lulus. Docker melaporkan provider `openai`, model DeepSeek tersebut, dan mode `live`; permintaan sintetis dari container ke `host.docker.internal:20128/v1` berhasil. `workspace.spec.ts` memeriksa model pada dialog serta tidak adanya input/tombol token manual, dengan bootstrap token tetap berfungsi.

