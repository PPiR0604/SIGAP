# Sesi uji pengguna SIGAP — laporan dengan nomor telepon dummy

Paket ini untuk peserta yang mencoba SIGAP secara langsung. Semua laporan, nama pelapor, dan nomor telepon dibuat untuk simulasi. Nomor merupakan angka contoh, bukan kontak yang telah diverifikasi atau nomor yang dijamin tidak aktif; jangan ditelepon atau dikirimi WhatsApp.

**Bagikan kepada peserta:** [PANDUAN-UJI-GDOCS.md](PANDUAN-UJI-GDOCS.md) dan folder [input](input/). Jawaban pembanding ada di [PANDUAN-FASILITATOR.md](PANDUAN-FASILITATOR.md); simpan terpisah dari peserta. Panduan peserta lama tetap tersedia sebagai referensi.

**Versi untuk disalin ke Google Docs:** [PANDUAN-UJI-GDOCS.md](PANDUAN-UJI-GDOCS.md) memakai satu tabel dengan 14 langkah berurutan. Tindakan peserta berada di kolom kiri dan teks siap salin berada di kolom kanan, termasuk isi CSV. Teks input memakai gaya percakapan WhatsApp: nomor HP sebagai pengirim, singkatan sehari-hari, PIC, dan variasi cara menyebut angka. Jumlah penduduk, stok, periode stok, dan target koreksi tetap mengikuti acuan skenario. Delapan skenario utama tetap tercakup; tugas opsional rename tidak dimasukkan ke panduan ringkas ini.

## Isi paket

| Berkas | Penggunaan |
| --- | --- |
| `PANDUAN-PESERTA.md` | Delapan tugas utama, langkah, dan pertanyaan evaluasi |
| `PANDUAN-UJI-GDOCS.md` | Panduan ringkas untuk Google Docs: satu tabel, 14 langkah, tindakan dan teks berdampingan |
| `input/01-laporan-baru.txt` | Dua laporan baru: Anggrek 50 jiwa dan Kenanga 64 jiwa, dengan kontak dummy |
| `input/02a-koreksi-harapan.txt` | Koreksi Harapan **Sukamaju**, bukan Harapan Cipandan |
| `input/02b-koreksi-cibening.txt` | Koreksi Cibening tanpa menghilangkan kandidat Harapan |
| `input/02c-koreksi-lansia-harapan.txt` | Koreksi lanjutan pada kandidat Harapan yang sama |
| `input/03-impor-konflik.csv` | Konflik Teduh dan Harapan Cipandan; nomor dummy berada dalam kolom catatan |
| `input/04a-laporan-parsial.txt` | Melati: estimasi dan stok belum diketahui |
| `input/04b-klarifikasi-melati.txt` | Melengkapi Melati setelah laporan parsial, tanpa mengubah total jiwa |
| `input/05-laporan-tidak-konsisten.txt` | Total 70 berbeda dari 35 laki-laki + 40 perempuan |
| `input/06-permintaan-buletin.txt` | Periksa kebutuhan lalu minta pratinjau buletin tanpa nomor telepon |
| `PANDUAN-FASILITATOR.md` | Prasyarat, hasil pembanding, pemeriksaan privasi, dan batas klaim |
| `expected-results.json` | Acuan angka dan urutan perubahan untuk fasilitator |
| `template-observasi.csv` | Catatan hasil nyata per peserta/per tugas; masih kosong |

Paket memakai baseline sebelumnya: **8 posko, 630 jiwa**, termasuk dua posko bernama Harapan di desa berbeda. Jangan mengirim ulang `../01-laporan-awal-whatsapp.txt` ke database yang sudah berisi baseline. Jangan menjalankan paket lama dan baru dalam sesi yang sama: Anggrek/Kenanga serta sasaran konflik memang digunakan kembali.

Tanggal contoh adalah **25 Oktober 2026, WIB**. Untuk sesi di hari lain, fasilitator mengganti tanggal pada seluruh input dan menyiapkan baseline dengan tanggal yang sama. Peserta tidak perlu mengubah nomor atau angka contoh. Laporan koreksi harus lebih baru daripada data baseline maupun perubahan yang sedang ditinjau.

Paket ini menyiapkan pengujian, belum merupakan hasil uji pengguna. Pembuatan paket tidak mereset atau mengisi database dan tidak mengirim persetujuan simpan maupun publikasi.

## Pemeriksaan paket, 25 Oktober 2026

Pemeriksaan lokal lulus untuk pembacaan dua baris CSV melalui parser aplikasi, konsistensi angka baseline → 744 → 752 → 760 jiwa, struktur delapan baris observasi, dan tautan panduan. Filter backend aktual serta pola nomor telepon dari preprocessor Langflow masing-masing menyamarkan seluruh **12 kemunculan nomor dalam delapan berkas laporan**. Ini pemeriksaan isi dan pemrosesan input lokal; seluruh alur UI, respons model, penyimpanan, dan hasil uji peserta belum dijalankan oleh pemeriksaan ini.

Arsip peserta tersedia di `output/user-testing/paket-peserta-sigap-2026-10-25.zip`, hanya berisi panduan peserta dan folder input. Panduan fasilitator, JSON acuan, dan lembar observasi tetap terpisah.
