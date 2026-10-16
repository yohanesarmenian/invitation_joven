# Backup dan restore local daily

Workflow menyimpan database dan konfigurasi yang mempertahankan link/QR. Restore membuat database baru untuk diperiksa; aplikasi daily tetap memakai database asal. Tidak ada overwrite atau promotion otomatis.

## Backup manual

Jalankan dari root proyek saat PostgreSQL daily hidup:

```powershell
pnpm local:backup
pnpm local:backup:list
pnpm local:backup:verify "<directory dari output backup>"
```

Backup boleh berjalan ketika aplikasi dipakai. Fingerprint seluruh tabel dan `pg_dump` memakai **exported PostgreSQL snapshot yang sama**. Penulisan setelah snapshot tidak menghasilkan paket campuran. Perubahan schema/migration dilakukan terpisah; migration history yang tidak cocok ditolak.

`BACKUP_COMPLETE` dicetak setelah seluruh tahap berhasil, beserta ID, directory, ukuran archive dan jumlah tabel. Paket disimpan di `.local-daily/backups/<UUID>/`:

| File             | Isi                                                                                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `database.dump`  | Archive custom PostgreSQL: semua tabel, termasuk tamu, RSVP, pass/check-in, admin/staff/sesi, pesan, import dan materi dalam DB                                                    |
| `recovery.env`   | Salinan persis `.env.daily`, termasuk credential secret dan password DB/operator                                                                                                   |
| `operation.json` | Metadata signed tentang operasi yang dimulai                                                                                                                                       |
| `manifest.json`  | Metadata selesai: waktu, profile/config fingerprint, PostgreSQL major, migration checksums, jumlah/hash row tiap tabel, ukuran/SHA-256 archive dan SHA-256 config; dilindungi HMAC |

Windows DACL membatasi directory ke user aktif + SYSTEM; POSIX memakai 700/600. Tool **tidak mengenkripsi** paket. Gunakan media privat/terenkripsi saat memindahkan salinan. Source code, foto, font dan desain dalam folder proyek disalin terpisah; file materi yang di-upload ke database ikut dump.

`backup:list` hanya membaca metadata signed (`SIGNED_MANIFEST_ONLY`), belum memeriksa seluruh archive. `backup:verify` membaca semua byte dan memeriksa checksum/ukuran/header, signature serta konfigurasi, lalu mengeluarkan `BACKUP_INTEGRITY_VERIFIED`. Itu pemeriksaan file; bukti restore baru diperoleh melalui perintah restore. List/verify tidak memerlukan PostgreSQL hidup selama konfigurasi asli tersedia.

Directory yang belum memiliki manifest selesai valid ditampilkan sebagai `INCOMPLETE_OR_UNTRUSTED`. Jangan mengedit isi paket. Kegagalan tidak memicu retry atau penghapusan otomatis; directory yang belum selesai tetap tersedia untuk diagnosis.

## Restore dan cleanup salinan

```powershell
pnpm local:restore "<directory backup>"
pnpm local:restore:remove "<directory receipt dari output restore>"
```

Restore memeriksa integritas, matching config, PostgreSQL major dan daftar/checksum migrasi **sebelum membuat target**. Backup versi schema lain ditolak, tanpa migrasi otomatis terhadap backup lama. Container/profile/database asal harus terverifikasi.

Target bernama `invitation_restore_daily_<random ID>`. Operator hanya memprovisi database/marker; isi archive dipulihkan sebagai role aplikasi **NOSUPERUSER/NOCREATEDB/NOCREATEROLE**, dalam satu transaksi. Fingerprint semua tabel dan migration history dibandingkan dengan manifest. Status `RESTORE_VERIFIED` baru diterbitkan setelah cocok. URL aplikasi dan konfigurasi daily tidak diganti.

Output menyebut database target dan directory receipt `.local-daily/restores/<UUID>/`. Receipt signed mencatat `ALLOCATING`, `RESTORING`, `VERIFIED`, `FAILED` atau `REMOVED`. `VERIFIED` adalah bukti pada waktu pemeriksaan; perubahan berikutnya pada salinan dapat mengubah datanya.

Saat gagal/terputus, receipt dipertahankan dan target yang sudah terbentuk tidak dihapus otomatis; target yang belum sempat dibuat dapat tetap tidak ada. Jangan mengulang restore otomatis karena invocation baru membuat salinan lain. Setelah salinan selesai diperiksa, jalankan cleanup eksplisit. UUID/name, signature/config, owner role dan database marker harus cocok; koneksi aktif, receipt modifikasi dan database daily/kerja lama ditolak. Tidak ada `DROP ... FORCE`, kill PID, atau penghapusan bundle backup. Receipt tetap disimpan sebagai jejak operasi.

Jika respons cleanup hilang sesudah DROP, pemanggilan ulang membaca nama target secara exact dan dapat menghasilkan `RESTORE_ALREADY_ABSENT`. Status receipt sendiri tidak dianggap bukti bahwa database hilang. Jika timeout masih menyisakan koneksi target, cleanup menolak sampai koneksi selesai; identitas yang belum jelas tetap dipertahankan.

## Konfigurasi dan retensi

QR/link memerlukan credential secret yang sama. Simpan `recovery.env` bersama dump secara privat. Pemulihan `.env.daily` adalah langkah operator; tool tidak menimpa konfigurasi atau mengganti secret. Pada mesin/folder baru, pulihkan source dan konfigurasi asli, siapkan lingkungan sesuai runbook, lalu restore ke salinan baru. Workflow mensyaratkan fingerprint konfigurasi persis sama; perubahan port/password/profile atau upgrade schema memerlukan review kompatibilitas terpisah.

Aturan operasional awal:

1. Backup sebelum import besar/perubahan schema/data penting, dan pada akhir sesi pengisian data.
2. Pertahankan sekurangnya **7 backup terbaru dan semua backup 30 hari terakhir**; simpan satu salinan mingguan di media terpisah.
3. Sebelum menghapus backup lama secara manual, pastikan backup terbaru lolos integrity check dan rehearsal restore.
4. Default tool mempertahankan semua backup. Scheduler, auto-prune dan upload cloud belum ditambahkan. Lokasi eksternal/retensi final ditentukan owner.

`.local-daily` diabaikan Git dan Docker build context. Jangan menyalin recovery config ke chat, dokumen publik atau repo. Menghapus volume PostgreSQL bukan langkah cleanup backup.

## Verifikasi pengembang

```powershell
pnpm local:down
pnpm local:test
pnpm local:lint
pnpm local:verify:backups
pnpm local:up
```

Verifier memakai database QA disposable miliknya, bukan menanam data contoh di daily. API compiled dari build terakhir dibutuhkan oleh fixture/backend rehearsal. Pengujian mencakup seluruh fingerprint tabel, RSVP/QR/login staff/konfirmasi/duplikat, write bersamaan, korupsi/secret/migrasi tidak cocok, ownership/active-client cleanup, process interruption, permissions dan transport QA lama. QA bundle dihapus hanya setelah metadata signed membuktikan asal dari QA milik run. Backup harian nyata tetap disimpan.

Hasil privat: `.local-daily/verification-backups.json`. Cakupan/batas: [DAILY-BACKUP-VERIFICATION.md](DAILY-BACKUP-VERIFICATION.md).
