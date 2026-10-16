# Development harian lokal

Backup manual untuk data daily sekarang tersedia melalui `pnpm local:backup`, integrity check, restore ke salinan terpisah dan cleanup dengan receipt signed. Lihat [runbook backup/restore](DAILY-BACKUP-RESTORE.md). Rehearsal QA pada catatan lama tetap berbeda dari backup harian nyata; tool tidak menimpa database daily dan belum menjalankan jadwal otomatis.

Mode ini menjalankan PostgreSQL persisten dalam Docker, API native dengan watcher, dan dua Next dev servers dengan hot reload memakai Webpack. Pada Windows, pilihan ini menghindari transform pool Turbopack yang terbukti bertahan setelah owner dihentikan paksa. Konfigurasi tunggal dimiliki `.env.daily`; tidak membaca database kerja sebagai fallback. Data harian tidak memiliki fixture cleanup otomatis.

## Mulai dari terminal privat

Jalankan di `D:\Projects\invitation_joven`, dengan Docker Desktop aktif dan dependency project yang sudah terpasang:

```powershell
pnpm local:init
pnpm local:catalog ops/daily/catalog.example.json
pnpm local:owner
pnpm local:up
```

`local:owner` meminta email, password tersembunyi, dan pengulangan password. Gunakan terminal interaktif pribadi; jangan masukkan password melalui chat, argv, atau source. Tidak ada akun/password default. Bootstrap menggunakan CLI existing, hanya bila belum ada AdminUser; rerun tidak mereset akun. Alternatif otomasi privat adalah `ADMIN_BOOTSTRAP_EMAIL` dan `ADMIN_BOOTSTRAP_PASSWORD` dalam environment proses, bukan file yang dibuat helper.

Pada mesin ini init dan katalog contoh sudah dijalankan. First OWNER harian **belum dibuat**, karena identitas/password dipilih sendiri oleh owner. Cukup jalankan `pnpm local:owner` saat PostgreSQL daily aktif, lalu login admin. Katalog contoh berisi dua acara development dengan tanggal/tempat `null`; keduanya bukan materi final Jo & Venta.

| Surface    | Alamat default        | Penggunaan                                      |
| ---------- | --------------------- | ----------------------------------------------- |
| Admin      | http://localhost:3201 | Login OWNER, tamu, staff, materi acara, laporan |
| Public     | http://localhost:3200 | Buka **link per household** dari dashboard      |
| API        | http://127.0.0.1:4200 | Backend nyata; health `/health`                 |
| Control    | 127.0.0.1:4201        | Privat, autentikasi instance; gunakan CLI       |
| PostgreSQL | 127.0.0.1:55433       | Database `invitation_daily`                     |

Root public `/` bukan undangan household. Link `/i/...` diterbitkan backend dan diambil lewat dashboard. Jangan mengganti credential link dengan contoh `AAAA...` dari preview.

## Pemakaian rutin

```powershell
pnpm local:up
```

Biarkan terminal itu hidup. Di terminal lain:

```powershell
pnpm local:status
pnpm local:down
```

Down menghentikan hanya stack daily yang terverifikasi dan mempertahankan volume. Up berikutnya memakai konfigurasi/secret/data yang sama; tidak bootstrap, reseed, reset atau menerapkan migration otomatis. Bila source migration berubah, review lalu gunakan `local:init` untuk deploy migration existing yang dipilih project. Jangan memakai `down -v`, `db push`, reset, atau test destructive pada database harian.

`status` membedakan `ready`, `starting`, `degraded`, `stopping`, `stopped`, `database-only`, dan `unknown`. Ready memerlukan worker milik supervisor dan HTTP health. Konflik port berhenti tanpa mematikan aplikasi lain. Jika Docker belum aktif, nyalakan Docker Desktop; helper tidak menginstal software.

Jika aplikasi induk berhenti paksa, worker menerima putusnya IPC dan berhenti. Bila status `unknown`, jalankan:

```powershell
pnpm local:recover
pnpm local:up
```

Recovery memverifikasi port bebas dan identitas database, lalu memindahkan manifest lama ke riwayat privat. Recovery tidak membunuh proses berdasarkan PID/port. Jika ditolak, pertahankan `.local-daily` dan periksa proses/konfigurasi secara eksplisit. Manifest rusak, secret hilang, atau identity mismatch tidak diperbaiki dengan wipe/reissue otomatis. Interupsi provisioning antara CREATE DATABASE dan COMMENT juga dapat memerlukan pemeriksaan operator; jangan menghapus database untuk melewati refusal.

## Alur aplikasi

1. OWNER membuat household lewat Invitations, named invitees, acara eligible, satu jatah spouse/plus one, dan batas tambahan anak.
2. Buka detail → **View public link**. Tamu mengisi RSVP dan pesan melalui link itu. Pass QR diterbitkan backend setelah RSVP memenuhi syarat.
3. OWNER membuat CHECKIN_STAFF lewat Settings → Staff. Password sementara muncul sekali; staff wajib menggantinya sebelum memakai scanner.
4. Staff memilih acara → kamera/typed QR → **Validate** → jumlah actual → **Confirm**. Validate tidak mencatat kedatangan. Respons confirm yang hilang harus direkonsiliasi melalui status authoritative; jangan otomatis mengulang confirm.
5. OWNER memeriksa Reports/export; expected RSVP berbeda dari actual check-in. Materi parkir/rundown diisi sebagai draft, preview, lalu publish melalui keputusan eksplisit OWNER.

Android fisik ditunda sesuai keputusan owner. `localhost` di Android menunjuk Android sendiri; profil ini hanya loopback komputer dan belum menyediakan HTTPS/LAN venue. Panduan perangkat ada di `INVITATION-ANDROID-REHEARSAL.md`; jangan menganggap tes kamera sintetis sebagai bukti kamera ponsel.

## Katalog dan konfigurasi

`ops/daily/catalog.example.json` menunjukkan format JSON UTF-8: `{ "events": [...] }`. Maksimum 20 event/64 KiB, field terbatas. Waktu wajib ISO dengan offset eksplisit, misalnya `2027-01-02T17:00:00+07:00`, atau `null` jika belum diketahui. Ends harus sesudah starts. Maps memakai HTTPS Google Maps yang disetujui validator. Duplicate slug/order ditolak.

Initializer membuat katalog kosong dalam satu transaksi; rerun identik no-op. Existing katalog berbeda ditolak tanpa mengubah event yang mungkin dipakai RSVP/check-in. Untuk pembaruan konfigurasi acara, OWNER sekarang memakai **Events** di `/events`; lihat [pengelolaan acara](EVENT-MANAGEMENT.md). Setelah mengedit melalui UI, rerun initializer dengan JSON awal dapat ditolak karena saved state sudah berbeda; jangan memakai initializer untuk menimpa perubahan editor.

`.env.daily` dibuat sekali dengan password DB/operator dan credential secret acak. Windows DACL membatasi file dan `.local-daily` untuk user aktif + SYSTEM; POSIX memakai mode 600/700. Jangan commit, mengirim, atau menampilkan isinya. Database/link/QR memerlukan **matching credential secret**; restore DB tanpa secret yang sama tidak memulihkan credential yang benar.

Nama DB/role dan loopback dimiliki parser; port dapat dipilih eksplisit dan harus berbeda. Perubahan port/origins perlu restart. Perubahan profile/secret pada database existing akan ditolak. Simpan salinan konfigurasi dan backup database secara privat, terpisah dari repo dan Docker context. Lokasi/retensi backup harian milik owner belum dipilih. Rehearsal QA di bawah ini **bukan backup data harian pengguna**.

## Verifikasi pengembang

Hentikan daily sebelum gate runtime/build. Jalankan berurutan:

```powershell
pnpm local:down
pnpm local:test
pnpm local:lint
pnpm typecheck
pnpm lint
pnpm local:build
pnpm local:verify
pnpm local:verify:gaps
pnpm local:verify:lifecycle
pnpm local:verify:context
pnpm local:up
```

`local:build` menghasilkan API compiled dan output Next `.next-daily`, sehingga tidak menimpa preview `.next`. Tidak menjalankan production image. `local:verify` membutuhkan API compiled untuk fixture existing; command build di atas memenuhinya. Jangan menjalankan beberapa Prisma generation atau suite destructive bersamaan.

`local:verify` membuat **database QA disposable** pada container daily yang terverifikasi. Aplikasi memakai supervisor yang sama dan port daily selama pengujian; bisnis sintetis tidak ditulis ke `invitation_daily`. Backup/restore memakai tool PostgreSQL 18 di container, sehingga tidak memakai `pg_dump` host versi 16. Role aplikasi tetap NOSUPERUSER/NOCREATEDB/NOCREATEROLE; operator digunakan hanya untuk provisioning dan QA restore. Cleanup hanya menargetkan nama QA tepat milik run. Jika cleanup gagal, identitas disimpan di `.local-daily/verification-cleanup-pending.json` dan run gagal.

`local:verify:lifecycle` membuat dua route HMR sementara, menguji outage DB/down/restart/force-owner-loss/partial startup, lalu menghapus route miliknya. `local:verify:context` membuat scratch export lewat Docker build dengan `.dockerignore` nyata; marker privat harus tidak masuk, source harus tetap ada. Output sementara hanya di direktori privat milik run. Ini tidak membuktikan runtime production image/Caddy.

Ringkasan hasil JSON privat: `.local-daily/verification.json`, `lifecycle-verification.json`, `context-verification.json`. Screenshot, trace, video dan DOM snapshot prompt Playwright dimatikan untuk perjalanan QR. Lihat `LOCAL-DAILY-DEVELOPMENT-VERIFICATION.md` untuk cakupan dan unknown; jangan menyamakan jumlah assertion dengan 74 skenario yang semuanya sudah dieksekusi.

`local:verify:gaps` menjalankan suite tambahan staff creation, CSV/XLSX, materi full restart, API-off guest submissions, process crash saat transaksi, dan kegagalan backup/cleanup. Hasil privatnya `verification-gaps.json`; detail ada di [laporan enam gap](LOCAL-DAILY-GAPS-VERIFICATION.md). Suite memakai API/PostgreSQL nyata pada QA disposable, menghentikan hanya child handles miliknya, dan tidak dijalankan bersamaan dengan verifier lain.
