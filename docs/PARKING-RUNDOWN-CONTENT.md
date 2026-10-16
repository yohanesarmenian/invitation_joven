# Materi parkir dan rundown

## Pengisian yang sekarang digunakan

Gunakan menu OWNER **Event materials** (`/event-content`) untuk materi sebenarnya. Backend/PostgreSQL menjadi sumber konten tamu; mengedit JSON contoh tidak lagi menerbitkan materi ke undangan.

1. Pilih acara yang sudah ada. Aktifkan bagian parkir dan/atau rundown yang diperlukan.
2. Isi judul dan petunjuk parkir, satu petunjuk per baris. Isi rundown dengan waktu mulai WIB, nama kegiatan dan keterangan. Cukup informasi yang perlu diketahui tamu.
3. Upload denah PNG/JPG/JPEG/WebP atau panduan PDF, maksimal **5 MiB per file** dan **8 file per acara**. Gambar didekode dan disimpan kembali sebagai PNG tanpa metadata sumber; PDF dibuka sebagai unduhan, bukan embed. Nama file asli tidak disimpan. Materi harus milik sendiri atau digunakan dengan izin venue.
4. Pilih gambar/PDF dari daftar file untuk dipasang pada draft; deskripsi gambar wajib saat publikasi. Tautan peta opsional menerima HTTPS `www.google.com/maps/...`, `google.com/maps/...`, atau `maps.app.goo.gl/...`.
5. **Save draft** menyimpan pekerjaan tanpa mengubah tampilan tamu. **Preview draft** memperlihatkan draft; **Preview published** memperlihatkan salinan yang sedang terbit. Kegiatan draft dengan waktu kosong tidak muncul pada preview; API tetap menolak publikasi sampai semua field wajib lengkap.
6. **Publish saved draft** membutuhkan konfirmasi dan menerbitkan salinan draft yang sudah disimpan. Perubahan draft berikutnya tidak mengubah salinan tersebut. **Hide published content** menyembunyikannya tanpa menghapus draft/file. Tamu harus memuat ulang halaman untuk melihat perubahan teks; request file baru selalu diperiksa kembali.
7. Untuk mengganti file, upload file baru, pilih pada draft, simpan, dan publikasikan lagi bila siap. File lama baru dapat dihapus setelah tidak direferensikan draft maupun salinan terbit. Tombol delete dinonaktifkan saat masih digunakan.

Simpan sebelum berpindah acara. Konflik versi atau hasil permintaan yang tidak pasti mengunci penulisan sampai **Reload saved state** dikonfirmasi. Reload membuang edit lokal dan membaca keadaan tersimpan; permintaan lama yang belum selesai masih dapat selesai kemudian. Tidak ada retry otomatis atau jaminan exactly-once dari reload. Jangan mengulang upload/publish secara membabi buta.

## Format persiapan materi

| Materi                           | Format                                                                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Denah parkir                     | PNG, JPG/JPEG, WebP                                                                                                                           |
| Panduan tambahan                 | PDF, opsional; pemeriksaan signature/EOF bukan sanitasi seluruh isi PDF                                                                       |
| Rundown untuk disiapkan di Excel | [rundown.mock.csv](content-templates/rundown.mock.csv), CSV UTF-8, satu kegiatan per baris                                                    |
| Contoh data terstruktur          | [parking.mock.json](content-templates/parking.mock.json) dan [rundown.mock.json](content-templates/rundown.mock.json), untuk mock development |

CSV rundown tetap lembar persiapan, belum ada importer CSV rundown. Jangan mengunggahnya melalui impor tamu. Masukkan kegiatan final melalui form admin. Jika memakai CSV/JSON untuk menyerahkan bahan, waktu seperti `2027-01-09T11:30:00+07:00` berarti 9 Januari 2027 pukul 11.30 WIB; waktu di template hanya contoh. Datetime input admin sudah berlabel WIB dan tidak memakai timezone komputer.

## Pratinjau mock tanpa database

File `apps/invitation-web/content/parking.json` dan `rundown.json` tetap draft contoh, terpisah dari konten tersimpan admin. Dari root proyek, di PowerShell:

```powershell
$env:VENUE_CONTENT_PREVIEW = "1"
rtk proxy pnpm --filter invitation-web dev
```

Buka `http://localhost:3000/dev/venue-preview`. Route memakai data sintetis tanpa tamu, API atau database. Tautan **No eligible event** menyembunyikan kedua bagian. Route mengembalikan 404 tanpa flag atau di production meskipun flag terpasang. Setelah server berhenti, hapus flag dengan `Remove-Item Env:VENUE_CONTENT_PREVIEW`. Opsi `VENUE_CONTENT_DIRECTORY` hanya memilih sumber mock ini, bukan sumber produksi.

Reader mock membatasi JSON 64 KiB, field sesuai template, dan referensi aset pasif lokal yang ada dengan signature sesuai serta ukuran <=5 MiB. File lama di `public` tetap aset publik; jangan menaruh draft/internal file di sana. Unggahan baru dari admin disimpan di database dan dibaca melalui endpoint yang memeriksa sesi OWNER atau credential undangan + acara eligible + referensi salinan terbit. Tidak ada fallback dari publikasi backend ke JSON lokal saat konten disembunyikan atau API gagal.

## Operasi lokal dan batas pekerjaan

Migrasi additive `20261015090000_event_content` diperlukan sebelum memakai editor dengan database development. Implementasi memverifikasinya pada database QA terpisah, **belum menerapkannya ke database development**. Setelah meninjau target DATABASE_URL dan membuat backup sesuai runbook, operator menjalankan `rtk proxy pnpm db:migrate:deploy`. Jangan menjalankan test integrasi destruktif terhadap database development.

Draft/file tersimpan tetap ada setelah restart dan ikut backup PostgreSQL. Restore rehearsal memeriksa draft, salinan terbit dan byte gambar yang sama. Tidak ada history publikasi atau antivirus PDF. Detail API, konflik versi, batas penyimpanan dan bukti REA vs desain orisinal ada di [EVENT-CONTENT-ADMIN.md](EVENT-CONTENT-ADMIN.md).

Materi venue, jadwal final dan persetujuan publikasi tetap menunggu pemilik. Tidak ada konten final yang ditebak atau dipublikasikan otomatis.
