# CI/CD dan deployment Coolify

Target repository: `yohanesarmenian/invitation_joven`, dengan default branch `master` yang diverifikasi melalui remote HEAD. Konfigurasi deployment sudah disiapkan pada source; resource/cabang rilis dan deployment belum diaktifkan. Server Coolify tersedia menurut owner, tetapi source GitHub App dan resource belum disiapkan. Domain masih contoh.

Hasil pemeriksaan lokal, perbaikan blocker build, integritas data, dan batas bukti dicatat di [COOLIFY-VERIFICATION.md](COOLIFY-VERIFICATION.md).

## Topologi

| Komponen         | Akses                                                                           | Port container |
| ---------------- | ------------------------------------------------------------------------------- | -------------- |
| `admin-web`      | `https://admin.example.com`; OWNER dan staff scanner                            | 3001           |
| `invitation-web` | `https://invite.example.com`; desktop dan mobile web memakai aplikasi yang sama | 3000           |
| `api`            | Internal stack; tidak diberi domain atau host port                              | 4000           |
| `migrate`        | Job satu kali; harus selesai sebelum API dimulai                                | Tidak ada      |
| PostgreSQL 18    | Resource Coolify terpisah, persisten, jaringan privat                           | 5432 internal  |

Browser admin mengakses `/api/admin/**` pada origin admin yang sama; Next mem-proxy ke `http://api:4000`. Web undangan mengakses API melalui server, bukan browser lintas origin. Tidak diperlukan CORS wildcard atau domain API publik. HTTPS admin wajib untuk cookie produksi dan izin kamera ponsel.

## CI

`.github/workflows/ci.yml` berjalan pada pull request, push `master`, dan manual dispatch:

1. Job `validate`: Prisma/schema/migration pada PostgreSQL CI, generated-contract drift, lint/typecheck/unit/integration, build, browser publik/admin, perjalanan tamu + kamera sintetis + identitas undangan, serta impor CSV/XLSX.
2. Job `containers`: `pnpm deploy:containers` membangun image produksi satu per satu, menjalankan migration dan tiga aplikasi pada PostgreSQL sintetis terpisah, memeriksa health/proxy/runtime, lalu menghapus stack QA miliknya.
3. Job `ready`: gagal jika salah satu job tidak sukses, termasuk gagal/cancel/skip. Gunakan check ini sebagai required status pada `master` setelah muncul pada run pertama.

CI tidak memakai kredensial produksi. Screenshot/trace/video sensitif tidak diunggah. `permissions` default hanya `contents: read`; promosi memiliki job terpisah dengan `contents: write` dan `actions: read`.

## CD melalui GitHub App

Coolify mendengarkan cabang rilis, bukan langsung `master`:

| Lingkungan | Cabang source Coolify | Pemicu                                                                  |
| ---------- | --------------------- | ----------------------------------------------------------------------- |
| Staging    | `deploy/staging`      | Manual; bisa otomatis sesudah CI sukses jika diaktifkan                 |
| Produksi   | `deploy/production`   | Workflow manual dengan SHA penuh dan approval environment bila tersedia |

Workflow **Promote to Coolify** memeriksa commit adalah ancestor `master` dan run push-master CI terbaru untuk SHA tersebut sudah selesai sukses pada repo yang sama. Update cabang hanya fast-forward, tidak menggunakan force push. Promosi otomatis staging yang sudah tertinggal dari `master` dilewati. Respons mutation yang hilang dibaca ulang melalui ref tepat, tanpa mutation kedua otomatis.

GitHub App Coolify menerima perubahan cabang dan membangun source-nya. Actions hanya memakai `GITHUB_TOKEN` bawaan; tidak ada PAT, token Coolify, atau private key GitHub App yang harus ditempel ke workflow. Private key/source credentials GitHub App tetap dimiliki Coolify.

Promosi ref **bukan** bukti deployment berhasil. Periksa Deployment Logs Coolify: SHA harus cocok, migration exit 0, tiga container sehat, domain/HTTPS bekerja, lalu rehearsal tamu dan staff. Pengiriman webhook GitHub App akibat update ref dari Actions serta permission update ref/workflow harus dibuktikan pada instalasi sebenarnya. Jika ditolak atau webhook tidak sampai, pertahankan ref/hasil CI dan diagnosis; jangan menambahkan token berhak luas atau force push sebagai fallback otomatis.

Tidak ada polling otomatis Coolify karena source ini belum dikonfigurasi dan pipeline tidak menyimpan token API Coolify. GitHub Environment pada promosi menandai persetujuan promosi, bukan readiness resource Coolify.

## Setup pertama

1. Review dan commit/push perubahan aplikasi beserta pipeline ke `master` melalui prosedur repo. Jalankan CI pertama dan pastikan `ready` sukses. File lokal yang belum dicommit tidak dapat dibaca Coolify.
2. Lindungi `master`: required PR/review dan check `ready`; batasi siapa yang dapat mengubah workflow. Cabang `deploy/*` hanya untuk promosi rilis, tidak untuk pengembangan langsung. Pastikan kebijakan organisasi mengizinkan permission job Actions yang diperlukan.
3. Buat GitHub Environments `staging` dan `production`. Pada masing-masing, variable `DEPLOYMENT_ENABLED=true` hanya setelah siap melakukan promosi. Untuk production, konfigurasi required reviewer/prevent self-review bila paket GitHub mendukungnya dan batasi workflow ke `master`. Default tidak ada variable berarti promosi ditolak.
4. Opsional: repository variable `AUTO_DEPLOY_STAGING=true` mengaktifkan promosi staging setelah CI push-master sukses. Biarkan belum diisi saat setup awal. Produksi selalu manual.
5. Jalankan **Promote to Coolify** dari ref `master`, pilih staging dan SHA CI yang sudah sukses. Ini membuat cabang rilis bila belum ada. Promosi pertama boleh terjadi sebelum resource Coolify dibuat; deploy pertama kemudian dipicu manual di Coolify untuk SHA yang sama.
6. Di Coolify, Sources → GitHub App → automated installation. Install hanya ke repository yang diperlukan. Jangan menyalin private key/token lewat chat atau repo.
7. Buat project/environment staging dan production yang terpisah. Buat PostgreSQL persisten terpisah untuk masing-masing. Jangan menghubungkannya ke database development harian.
8. Buat resource **Private Repository with GitHub App**, pilih repo tersebut dan cabang sesuai lingkungan. Build pack **Docker Compose**, Base Directory `/`, Compose file `/compose.coolify.yaml`, deployment normal; jangan pilih Raw.
9. Hubungkan application stack dan database ke predefined network pada server yang sama. Pakai hostname internal database dari Coolify pada URL; jangan gunakan `localhost`, alamat development, atau port publik. Verifikasi konektivitas job `migrate` juga.
10. Masukkan environment di bawah. Atur domain `admin-web` dengan port 3001 dan `invitation-web` dengan port 3000; jangan beri domain `api`/`migrate`. Atur HTTPS/certificate, lalu **Deploy on push (webhooks)** untuk cabang rilis. Untuk membatasi build, gunakan Custom Build Command `docker compose --parallel 1 build`; Coolify harus tetap menyisipkan file/env-file resource yang benar. Periksa command efektif pada deployment pertama.
11. Review deployable Compose Coolify: `migrate` dikecualikan dari aggregate health melalui `exclude_from_hc`, dependency completion tetap ada, tidak ada host port API/DB, dan service name `api` tetap bisa di-resolve oleh web containers.
12. Jalankan deploy pertama, cocokkan SHA serta hasil health/migration, lalu bootstrap OWNER secara privat. Akun sintetis CI tidak pernah menjadi akun produksi.

Satu server/network destination dipakai oleh application stack dan database per lingkungan. Deployment lintas server memerlukan rancangan jaringan berbeda dan belum disiapkan di sini.

## Environment dan database

Template: `ops/deploy/coolify.env.example`. Isi nilai nyata hanya dalam pengelolaan secret Coolify:

| Key                          | Pemakaian                                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`               | Runtime API, role aplikasi dengan hak CRUD/sequence yang diperlukan, tanpa superuser/createdb/createrole |
| `MIGRATION_DATABASE_URL`     | Hanya job `migrate`; role pemilik schema dan migration, tanpa superuser/createdb/createrole              |
| `CREDENTIAL_SECRET`          | Base64url kanonis dari tepat 32 byte acak; persisten sepanjang umur link dan QR                          |
| `ADMIN_ORIGIN`               | Origin HTTPS tepat domain admin; tanpa path/wildcard                                                     |
| `PUBLIC_INVITATION_BASE_URL` | Origin HTTPS undangan; menghasilkan link personal dari backend                                           |

Upstream `ADMIN_API_INTERNAL_BASE_URL=http://api:4000` menjadi build argument admin dan runtime env; `INVITATION_API_BASE_URL=http://api:4000` hanya runtime server undangan. Jangan mengubah nama service API tanpa membangun ulang admin. Secret database/credential tidak menjadi Docker build argument. Aktifkan ketersediaan `SOURCE_COMMIT` saat build di Coolify bila ingin label image berisi commit; bila tidak tersedia label bernilai `unknown`, bukan bukti identitas rilis.

Provisioning database adalah tindakan operator. Untuk database kosong, buat role migrator dan aplikasi tanpa hak elevated, jadikan migrator pemilik database/schema, beri aplikasi `USAGE` schema dan CRUD tabel + USAGE/SELECT sequence, serta set default privileges **untuk objek yang dibuat migrator** sebelum migration pertama. Jangan berikan migration URL ke container API. Jika database/role sudah ada, review ownership dan grant yang tersimpan; jangan menghapus atau meresetnya.

Contoh SQL role/grant dengan password publik **hanya untuk QA** ada di `ops/deploy/container-test-roles.sql`. Jangan jalankan file QA ini di production. Password produksi dipilih/dihasilkan dan dipasang melalui fasilitas privat operator; URL-encode password dalam connection URL.

Backup sebelum migration produksi, dan uji restore PostgreSQL melalui mekanisme backup resource/operasional Coolify yang dipilih. Simpan juga matching `CREDENTIAL_SECRET` secara privat dan terpisah. Restore database saja tanpa secret yang sama tidak memulihkan link/QR. Jangan menyalin `.env.daily` atau backup guest development ke image.

## Bootstrap OWNER

Di container API, gunakan terminal operator privat dengan `ADMIN_BOOTSTRAP_EMAIL` dan `ADMIN_BOOTSTRAP_PASSWORD` sebagai environment sementara. Jangan menyimpan bootstrap password sebagai runtime env permanen, menuliskannya dalam argv/history, atau menyalinnya ke chat. Dari `/workspace`:

```sh
node ops/deploy/bootstrap-owner.mjs
```

Entry point ini memakai fungsi bootstrap compiled yang sudah ada. Ia menolak bila sudah ada AdminUser dan tidak mereset akun. Hapus environment sementara setelah selesai, login lewat HTTPS admin, lalu buat staff melalui UI.

## Migration, rollback, dan update

Job migration menjalankan Prisma langsung melalui Node. Startup aplikasi juga langsung melalui Node/exec, sehingga tidak mengunduh pnpm saat container dimulai. Build web container memakai opsi Webpack dari Next.js yang terpasang dan batas heap Node 1536 MiB; dependency install berada pada layer bersama sebelum pilihan APP. Batas heap bukan batas total memory build. Migration harus exit 0 sebelum API berjalan; web services menunggu API sehat. Kegagalan migration tidak boleh dilanjutkan dengan reset/db push.

Gunakan migration additive yang kompatibel dengan versi aplikasi sebelumnya selama penggantian container. Jangan menganggap Compose memberikan zero downtime atau mengganti empat service secara atomik. Review perubahan schema sebelum promosi produksi.

Promosi tidak bisa memundurkan cabang. Rollback kode yang normal adalah **revert commit pada master → CI sukses → promosi SHA baru**. Rollback image melalui dashboard membutuhkan review kompatibilitas database. Pipeline tidak menjalankan down migration atau restore database otomatis. Jika ref sudah menunjuk SHA yang diminta, workflow melaporkan no-op dan tidak mengklaim mengirim webhook baru; redeploy eksplisit dilakukan lewat Coolify setelah inspeksi.

## Privasi dan verifikasi sesudah deploy

- Audit access/error logs proxy Coolify/Traefik, CDN, platform drain, dan APM sebelum mengirim link nyata. Path `/i/<credential>` dan path API publik membawa bearer credential. Log aplikasi yang sudah disanitasi tidak melindungi log proxy.
- Pertahankan `Referrer-Policy: no-referrer`; jangan gunakan analytics/error reporting yang merekam URL personal, isi RSVP/pesan, cookie, atau QR.
- Pastikan cookie `__Host-admin_session` Secure/HttpOnly/host-only dan browser staff tetap satu origin untuk API.
- Uji satu household sintetis melalui HTTPS: sapaan → RSVP → QR → staff scan → confirm → duplicate refusal → Reports. Uji Android fisik dan izin kamera sebelum venue.
- Verifikasi backup terjadwal/retensi/restore, kapasitas VPS, notification operasional, kebijakan log, dan secret recovery di server. Repo belum mengaktifkan jadwal backup produksi atau monitor eksternal.

## Pemeriksaan lokal

```powershell
pnpm deploy:test
pnpm deploy:lint
pnpm deploy:containers
```

Runner container memakai port loopback 42700–42702 dan project Docker QA acak. Ia menolak port yang terpakai dan tidak menghentikan aplikasi lain. Native Compose dibuat dari source melalui parser YAML; hanya field Coolify `exclude_from_hc` yang dihapus untuk engine lokal. Stack memakai PostgreSQL tmpfs, role aplikasi terbatas, dan fixture publik. Cleanup menargetkan identitas project acak tersebut; jika gagal identitas dipertahankan dalam `.local-daily/container-smoke-cleanup-pending.json`.

Hasil mesin/log ada di `.local-daily/container-smoke.json` dan diagnostics privat. Ini bukan deployment Coolify atau pembuktian TLS/proxy aktual.

## Referensi

- [Coolify GitHub App](https://coolify.io/docs/applications/sources/github/app)
- [Coolify automatic deployments](https://coolify.io/docs/applications/deployments/automatic-deployments)
- [Coolify Docker Compose Application dan migration health exclusion](https://coolify.io/docs/applications/builds/docker-compose)
- [GitHub workflow runs API](https://docs.github.com/en/rest/actions/workflow-runs)
- [GitHub refs API](https://docs.github.com/en/rest/git/refs)
- [GitHub token event behavior](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
