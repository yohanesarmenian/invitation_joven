# Task mode development harian dan rencana test case

Follow-up 16 Oktober: slice Pengelolaan Acara disetujui terpisah setelah mode daily. OWNER create/edit dan sinkronisasi tanggal dijelaskan di [EVENT-MANAGEMENT.md](EVENT-MANAGEMENT.md). Pengecualian Event CRUD di baseline berikut tidak menggambarkan kontrak terbaru; delete tetap tidak tersedia.

Tanggal: 16 Oktober 2026, Asia/Jakarta. **Implementasi mode daily telah ditambahkan setelah rencana ini disetujui.** Infrastruktur, katalog development, supervisor, isolated QA dan runbook tersedia. First OWNER harian menunggu input privat owner; Android tetap ditunda. Hasil dan cakupan parsial dicatat di [verification](LOCAL-DAILY-DEVELOPMENT-VERIFICATION.md), pemakaian di [runbook](LOCAL-DAILY-DEVELOPMENT.md).

Bagian berikut mempertahankan baseline dan acceptance awal sebagai checklist, termasuk kata “usulan/belum” yang menggambarkan kondisi **sebelum implementasi**, bukan status runtime sekarang. Daftar 74 skenario bukan klaim 74 tes telah lulus. Tidak ada staging, commit atau deployment pada implementasi ini.

Tujuan: OWNER dapat mengelola tamu dan materi acara, tamu dapat mengisi RSVP/pesan, staff dapat check-in, dan semua data tetap tersimpan setelah aplikasi atau PostgreSQL direstart. Mode harian harus terpisah dari preview visual dan fixture QA yang memiliki cleanup otomatis.

## 1. Fakta baseline dan gap sebelum implementasi

| Area                      | Bukti source yang diperiksa                                                                                                                                   | Implikasi untuk task                                                                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Startup root              | `package.json`: `dev` menjalankan `turbo run dev`; belum ada workflow daily init/up/status/down terpadu                                                       | Butuh orchestrator development, bukan implementasi ulang fitur undangan                                                                                                                            |
| Stack built               | `compose.local-stack.yaml`, `Dockerfile`, `LOCAL-OPERATIONS.md` sudah menyediakan PostgreSQL persisten, migration service, API, dua Next apps dan Caddy HTTPS | Reuse pola persistence/health/migration. Stack ini memakai port 3000/3001 dan aplikasi built; runtime Docker/CA tidak diverifikasi ulang pada sesi ini                                             |
| Helper QA                 | `ops/local-journey.mjs` mewajibkan database `invitation_qa_*`, mengaktifkan flags test/workflow, memakai 3100/3101/4100                                       | Tetap khusus QA. Jangan menggantinya menjadi daily atau memakai fixture ephemeral sebagai data harian                                                                                              |
| Perlindungan database tes | `apps/api/test/database-safety.ts` memeriksa flag, loopback dan allowlist nama test/QA                                                                        | Nama database daily harus berada di luar allowlist. Guard existing tidak dilonggarkan                                                                                                              |
| Akun                      | `bootstrap-owner.ts`, `scripts/admin-bootstrap-owner.ts`, staff management existing                                                                           | First OWNER melalui CLI operator, tanpa default password; staff melalui OWNER, temporary password ditampilkan sekali dan first login wajib ganti                                                   |
| Acara                     | `admin-read.controller.ts` menyediakan GET events; kontrak API menegaskan tidak ada Event create/update/delete endpoint                                       | Pengisian katalog acara butuh initializer lokal yang terbatas atau task Event management terpisah. Jangan mengklaim acara sudah bisa dibuat/diedit lewat dashboard                                 |
| Materi acara              | OWNER event-content editor sudah mendukung draft/upload/preview/publish/hide                                                                                  | Reuse fitur existing; data parkir/rundown contoh tetap draft sampai owner memilih publish                                                                                                          |
| Binding API               | `apps/api/src/main.ts` memakai `app.listen(port, "0.0.0.0")`                                                                                                  | Launcher native saja belum menjamin local-only. Tambahkan konfigurasi bind host agar daily dapat memakai loopback, dengan perilaku container tetap didukung                                        |
| Output Next               | Dua `next.config.ts` memakai `NEXT_QA_DIST_DIR` atau `.next`                                                                                                  | Daily perlu output tersendiri agar hot reload/build tidak menimpa preview/QA; jangan menamai konfigurasi umum sebagai QA-only bila dipakai daily                                                   |
| Build context             | `Dockerfile` memakai `COPY . .`; `.dockerignore` mengecualikan `.next` dan `.env*`, belum menyebut `.next-journey` atau `.local-journey.json`                 | Jika output/file privat tersebut ada saat build, source rules belum mengecualikannya. Ini derivasi dari konfigurasi, **bukan bukti sudah terjadi kebocoran**. Tutup sebelum image build berikutnya |
| Data bisnis               | Backend RSVP/messages/pass/check-in/reporting dan real E2E sudah tersedia                                                                                     | Verifikasi pada daily profile dengan data persisten; tidak perlu menulis ulang API bisnis                                                                                                          |

Hasil QA sebelumnya ada di `INVITATION-END-TO-END-VERIFICATION.md`. Hasil tersebut tidak otomatis membuktikan startup, isolasi database, persistence atau resource cleanup pada daily profile yang belum dibuat.

## 2. Rancangan mode yang direkomendasikan

Daily default: **PostgreSQL dalam container/volume khusus, API dan dua Next apps berjalan native dengan hot reload**. Ini memenuhi development harian tanpa mewajibkan build semua image atau certificate trust. Existing built Docker/Caddy stack tetap jalur terpisah untuk rehearsal production-like nanti.

| Profil                  | Public                  | Admin                   | API                     | Database/output                                               |
| ----------------------- | ----------------------- | ----------------------- | ----------------------- | ------------------------------------------------------------- |
| Preview visual existing | Port 3000               | —                       | Mock 4010               | Tidak diubah oleh daily                                       |
| Real QA existing        | Port 3100               | Port 3101               | Port 4100               | `invitation_qa_*`, `.next-journey`; fixture boleh dibersihkan |
| **Daily usulan**        | `http://localhost:3200` | `http://localhost:3201` | `http://127.0.0.1:4200` | DB `invitation_daily`, volume khusus; `.next-daily` per app   |

PostgreSQL daily usulan dipublish hanya pada `127.0.0.1:55433`, role aplikasi non-superuser. Port/nama tersebut adalah rancangan, **belum dicek ketersediaannya pada saat eksekusi**. Preflight harus menolak konflik, bukan menghentikan proses lain atau mengganti port diam-diam. Nilai sebenarnya dimiliki satu konfigurasi daily dan dipakai untuk origins, links, health dan API upstream.

Tidak ada LAN/public exposure, perubahan sertifikat perangkat atau deployment pada slice ini. Android T12 tetap ditunda sesuai pilihan owner.

## 3. Batas scope

**Dikerjakan:** konfigurasi daily, database/volume terpisah, startup/status/shutdown, bootstrap lewat CLI existing, katalog acara lokal yang tervalidasi, penggunaan dashboard existing, persistence/backup rehearsal, privacy/build-context guard, test dan runbook.

**Tidak otomatis masuk:** Event CRUD web/API, theme builder/CMS, perubahan desain/font/foto, partial arrival atau koreksi check-in, offline queue, walk-in, fitur RSVP baru, hosting/domain, production migration/deployment dan publikasi materi final. Jika ditemukan kebutuhan kontrak baru, definisikan slice terpisah sebelum implementasi fitur tersebut.

Jangan mengubah `.env` kerja, reset data lama, menerapkan migration pada database lain, membuat OWNER default, mengimpor tamu sungguhan, atau memublikasikan mock content secara otomatis. DB daily baru hanya menerima existing migrations; tidak diantisipasi ada schema/migration baru.

## 4. Detail work breakdown

### LD00 — Baseline dan keputusan profil

- Catat HEAD, branch, staging/worktree; snapshot hash file source/aset yang relevan.
- Inventaris hanya proses/port/database yang diperlukan tanpa dump environment atau credential.
- Tetapkan konfigurasi daily tunggal dan pemisahan daily/preview/QA.
- Konfirmasi runtime Docker, lokasi CLI dan dependency existing ketika eksekusi; jangan menginstal atau meng-upgrade software lain otomatis.
- Output: baseline privat lokal dan profil yang dapat direview.
- Acceptance: worktree lama utuh; target daily tidak ambigu; konflik atau prasyarat yang belum tersedia dilaporkan jelas.
- Dependensi: tidak ada. Test: D01–D04.

### LD01 — Konfigurasi dan secret daily

- Tambahkan template tanpa secret dan loader untuk ignored `.env.daily` atau lokasi privat eksplisit yang setara.
- Validasi host/port, origins tanpa path/query/userinfo, database target dan API upstream. Tidak ada fallback ke mock API atau `.env` database kerja.
- Generate password DB dan `CREDENTIAL_SECRET` hanya pada init pertama; simpan privat, jangan tampilkan nilainya. Init berikutnya tidak mengganti secret atau file existing diam-diam.
- Bootstrap OWNER menggunakan input privat sesuai CLI existing; password tidak masuk argv, source, log atau file yang dibuat helper. Secret runtime DB/HMAC berbeda dari password OWNER dan tidak menggunakan fixture QA.
- Jangan mewariskan flags destruktif/test ke daily. Normalisasikan konfigurasi sekali pada pemiliknya; semua subprocess memakai hasil parsing yang sama.
- Output: config loader/template, aturan ignore dan pesan error yang aman.
- Acceptance: konfigurasi invalid berhenti sebelum side effect; restart mempertahankan secret; tidak ada default credential.
- Dependensi: LD00. Test: D05–D10.

### LD02 — PostgreSQL persisten dan migrasi existing

- Tambahkan service PostgreSQL daily terpisah dengan volume/nama project yang tidak berbenturan dengan stack lain.
- Pakai role aplikasi non-superuser; provisioning administratif hanya pada container daily yang dimiliki workflow.
- Verifikasi identity server/database/role sebelum migration/initializer. Tolak target yang menyimpang.
- Terapkan empat migrations existing pada DB daily baru; catat status/history. Startup selanjutnya memeriksa kesiapan dan drift, tanpa reset.
- Sediakan down yang mempertahankan volume. Tidak ada `down -v`, drop DB atau recovery dengan wipe otomatis.
- Output: konfigurasi database daily dan workflow init/status yang idempotent.
- Acceptance: start/stop/recreate container normal mempertahankan data; test guard menolak DB daily; DB kerja/QA tidak tersentuh.
- Dependensi: LD01. Test: D11–D17.

### LD03 — Startup satu perintah, hot reload dan resource ownership

- Usulan command: `local:init`, `local:up`, `local:status`, `local:down`; nama final dipilih saat implementasi. **Command ini belum tersedia saat dokumen dibuat.**
- Pisahkan init yang membuat konfigurasi/provisioning dari up yang menjalankan profil existing. Fresh config hilang menghasilkan instruksi init, bukan secret regeneration.
- Up memeriksa konflik port dahulu, menunggu PostgreSQL/migration, lalu menjalankan satu API watcher dan dua Next dev servers dengan konfigurasi daily.
- Tambahkan bind-host API yang tervalidasi: daily loopback; default/container binding tetap kompatibel. Dua Next dev servers juga loopback.
- Generalisasi pemilihan distDir bila diperlukan; daily `.next-daily`, QA `.next-journey`, default `.next`. Tambahkan ignore ESLint/format/build context yang relevan tanpa mengabaikan source.
- Gunakan child/process-family ownership yang nyata untuk shutdown dan recovery. Windows Ctrl+C, partial startup dan parent exit harus ditangani. Jangan kill semua Node, semua port listeners atau proses hanya berdasarkan PID/path yang mungkin dipakai ulang.
- Status membedakan running/ready/degraded/stopped/unknown. HTTP 200 dari server asing tidak membuktikan stack milik workflow ini.
- Batasi concurrency startup/build/test; hindari menjalankan Prisma generation bersama. Tidak menyatakan penyebab freeze ChatGPT sebelumnya sudah didiagnosis atau diperbaiki.
- Output: supervisor lokal, health/status dan shutdown yang mempertahankan DB.
- Acceptance: satu command menghasilkan stack siap pakai; gagal parsial dibersihkan; proses asing dan preview tetap hidup; hot reload tidak mengganggu profil lain.
- Dependensi: LD02. Test: D18–D27.

### LD04 — First OWNER dan staff melalui workflow existing

- Jalankan CLI bootstrap existing pada DB daily terverifikasi; tidak menambah signup/setup endpoint.
- Jika AdminUser sudah ada, gunakan login existing; jangan mencoba bootstrap sebagai reset password.
- Buat CHECKIN_STAFF melalui dashboard OWNER. Temporary password ditampilkan sekali, first login wajib ganti, dan sign-out/reset/disable mengikuti kontrak existing.
- User menentukan identitas/password OWNER secara privat ketika setup; dokumen ini tidak memilih akun atau menanam default.
- Output: akun persisten yang dibuat melalui writer resmi dan panduan akses.
- Acceptance: tepat satu first OWNER; staff dibatasi; akun tetap ada setelah restart; tidak memakai synthetic fixture password untuk akun harian.
- Dependensi: LD03. Test: D28–D35.

### LD05 — Initializer katalog acara development

- Gunakan initializer **operator-only** untuk DB daily, bukan endpoint publik atau fitur Event CRUD terselubung.
- Input usulan: JSON UTF-8 berisi slug, nama, display order, active flag, starts/ends, venue, address dan Maps URL. Tentukan schema/batas ukuran saat implementasi; jangan menerima arbitrary Prisma data atau SQL.
- Waktu input wajib ISO dengan timezone/offset eksplisit; UI tetap Asia/Jakarta. Waktu/venue yang belum final boleh belum terisi sesuai model, bukan tanggal/venue karangan yang terlihat final.
- Init fresh catalog secara atomik; rerun identik adalah no-op. Slug/order conflict atau existing row berbeda harus berhenti dan melaporkan perbedaan aman; jangan update event yang sudah dipakai RSVP/check-in secara diam-diam.
- Katalog contoh diberi nama sintetis yang jelas. Konten Jo & Venta final hanya diisi dari materi owner yang tersedia. Materi parkir/rundown tetap draft lewat editor existing.
- Output: template katalog, parser/domain validation dan initializer yang guarded/idempotent.
- Acceptance: eligible event tersedia untuk dashboard tanpa memodifikasi invitations/RSVP/attendance existing; partial import tidak meninggalkan katalog separuh jadi.
- Dependensi: LD02, LD03; akun LD04 untuk penggunaan UI. Test: D36–D42.

### LD06 — Rehearsal dashboard sampai tamu dan staff

- OWNER membuat household contoh melalui UI existing, menambah named invitees, kuota spouse/plus one bersama, anak dan eligible events.
- Ambil current link melalui UI; guest context terpisah mengisi RSVP/pesan. Buktikan canonical read dan persisted state, bukan toast saja.
- OWNER mengedit draft/upload/preview materi acara; published snapshot existing tetap terpisah. Publish contoh hanya merupakan langkah eksplisit pada fixture sintetis QA, bukan otomatis di daily.
- STAFF validate → actual count → confirm; OWNER memeriksa reports/export. Bedakan expected dan actual.
- Reuse existing real E2E dan tambah assertions khusus daily profile; destructive fixtures tetap dijalankan pada database QA disposable, bukan DB daily user.
- Output: satu alur penggunaan yang dapat dilakukan sendiri dan repeatable regression.
- Acceptance: tidak ada mock fallback; semua write terjadi pada target yang benar; unauthorized access ditolak; tidak ada confirm otomatis/replay.
- Dependensi: LD04, LD05. Test: D43–D53.

### LD07 — Restart, persistence dan backup/restore

- Buat baseline synthetic dataset dengan RSVP, pesan, pass, check-in dan materi upload/publication pada lingkungan verifikasi terisolasi.
- Buktikan restart aplikasi dan down/up database mempertahankan UUID, versi RSVP, pass lifecycle, exact credential di memori, attribution/timestamp/count, media bytes dan publication.
- Reuse backup rehearsal existing pada **QA terpisah**, dengan matching credential secret. Jangan menjalankan fixture cleanup atau restore di DB daily.
- Periksa ketersediaan `pg_dump`/`pg_restore` dan role provisioning yang berwenang membuat database restore terisolasi. Jangan memberikan CREATEDB/superuser kepada role aplikasi daily hanya agar rehearsal lolos.
- Dokumentasikan backup DB dan penyimpanan secret sebagai dua hal yang diperlukan; credential secret tidak digenerate ulang sebagai recovery.
- Setelah crash/force termination, status ownership direkonsiliasi; data tidak dihapus sebagai jalan pintas.
- Output: evidence persistence, rehearsal restore dan runbook pemulihan.
- Acceptance: data tetap ada setelah restart; restore exact di DB baru; QR/public links tetap sah dengan secret yang sama; database asal tidak ditimpa.
- Dependensi: LD06. Test: D54–D62.

### LD08 — Privacy, build context dan error handling

- Eksklusi `.env*`, private rehearsal files, `.next-journey`, `.next-daily`, test output dan backup material dari Docker context/artifact sesuai pemilik formatnya.
- Uji memakai marker sintetis yang tidak sensitif; keberadaan file ignored Git saja bukan bukti file dikecualikan Docker.
- Periksa API, Next, supervisor dan proxy pada jalur normal/error. Credential/password/CSRF/session, private input dan credential-bearing URL tidak masuk laporan/log yang tidak semestinya.
- Environment diagnosis hanya allowlist metadata non-secret; jangan serialize ambient environment atau command argv sensitif.
- Pertahankan server-action privacy, no-store, role/CSRF/origin, first-password-change dan redaction existing. Local HTTP hanya loopback/nonproduction.
- Output: narrow ignore/config fixes dan privacy/artifact evidence. Ini harus selesai sebelum image build berikutnya.
- Acceptance: marker privat tidak masuk build artifact/context yang dikirim; negative cases tidak membocorkan credential; daily tidak terekspos LAN.
- Dependensi: LD01; bisa diaudit sebelum LD06, ditutup sebelum LD09. Test: D63–D69.

### LD09 — Gates, dokumentasi dan handover

- Jalankan lint/typecheck/format/build dan test yang relevan setelah perubahan. Prisma generation serta suite database yang mengubah fixture berurutan.
- Test supervisor/config pada unit/integration boundary; startup, shutdown, persistence, migrations, auth dan concurrency pada proses/database nyata sesuai kasusnya.
- Dokumentasikan fresh setup, setup existing, up/status/down, bootstrap, katalog acara, link tamu, backup/restore, konflik port, wrong secret, failed migration dan crash recovery.
- Catat mode data, source/diff, target database/role aman, command/results, skip dan unknown. QR aktif tidak disimpan sebagai screenshot/trace/video.
- Buktikan source/aset lama utuh, staging/HEAD tidak berubah tanpa permintaan commit; environment privat tidak ikut diff.
- Output: runbook daily dan laporan verifikasi aktual. Status rencana baru berubah selesai berdasarkan bukti.
- Acceptance: user bisa menjalankan workflow harian dan restart tanpa cleanup fixture atau menebak konfigurasi; batas fisik/produksi tetap jelas.
- Dependensi: LD00–LD08. Test: D70–D74.

## 5. Test case yang diusulkan

Semua kasus berikut **belum dijalankan untuk task daily baru**. P0 = blocker untuk handover; P1 = perlu ditutup sebelum task dinyatakan lengkap atau ditandai gap eksplisit. Bukti lama boleh dipakai untuk memilih regression yang relevan, bukan mengganti bukti daily runtime. Tidak harus membuat 74 test file baru: reuse/parameterize test existing dan gunakan satu lifecycle scenario untuk beberapa assertions yang berhubungan.

### Baseline, konfigurasi dan database

| ID  | Pri | Skenario / pemicu                                                     | Expected result                                                                           | Bukti utama                           |
| --- | --- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------- |
| D01 | P0  | Worktree sudah dirty saat mulai                                       | Existing edits/staging/HEAD dipertahankan                                                 | Snapshot/hash + git state             |
| D02 | P0  | Preview/QA atau aplikasi lain sedang hidup                            | Inventaris tidak mematikan/mengubah proses atau data mereka                               | Identity/ports sebelum-sesudah        |
| D03 | P1  | Docker CLI tidak di PATH / daemon mati                                | Lokasi configured dapat dipakai; daemon mati memberi alasan jelas, tanpa install otomatis | Real command/error aman               |
| D04 | P0  | Operator memilih target yang tidak sesuai profil                      | Berhenti sebelum provisioning/migration/write                                             | Negative preflight + unchanged DB     |
| D05 | P0  | Daily config belum ada                                                | Up meminta init; tidak memakai `.env` kerja/mock sebagai fallback                         | CLI integration                       |
| D06 | P0  | Init fresh lalu init kedua                                            | Secret/config pertama dipertahankan; rerun no-op atau refusal jelas                       | Hash file privat tanpa isi            |
| D07 | P0  | Secret hilang/invalid atau password placeholder                       | Berhenti; secret tidak tercetak                                                           | Output capture dengan marker sintetis |
| D08 | P0  | Origin berisi userinfo/path/query; host LAN; port invalid             | Validasi menolak sebelum spawn/write                                                      | Parser boundary cases                 |
| D09 | P0  | Ambient flags test/QA aktif pada shell                                | Daily tidak mengaktifkan fixture/test cleanup                                             | Sanitized child env assertions        |
| D10 | P0  | Config daily valid dan port disesuaikan eksplisit                     | Semua origins, public link, rewrite dan health memakai satu konfigurasi                   | Runtime request/link check            |
| D11 | P0  | Database/volume daily belum ada                                       | Hanya target daily dibuat; application role bukan superuser                               | PostgreSQL identity/role/volume       |
| D12 | P0  | Deploy empat migration existing ke DB fresh                           | Semua applied; schema sesuai existing; tidak membuat migration baru                       | Prisma history/status                 |
| D13 | P0  | Deploy/start ulang pada DB initialized                                | Tidak reset/reseed/duplikasi atau mengubah secret                                         | Migration history + row invariants    |
| D14 | P0  | Migration gagal atau schema drift                                     | API belum dinyatakan ready; data/volume tetap ada; tidak auto-wipe                        | Failure injection isolated DB         |
| D15 | P0  | PostgreSQL down / credentials salah                                   | Error connection aman; tidak fallback ke DB lain                                          | Real connection failure               |
| D16 | P0  | Suite destructive diberi DB `invitation_daily`, meski test flag aktif | Guard existing menolak sebelum fixtures/write                                             | Guard integration + unchanged rows    |
| D17 | P0  | Provision daily sementara database kerja/QA berisi data               | Database/volume lain tidak berubah                                                        | Scoped independent SQL/count/hash     |

### Startup, shutdown dan hot reload

| ID  | Pri | Skenario / pemicu                             | Expected result                                                                        | Bukti utama                        |
| --- | --- | --------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------- |
| D18 | P0  | Fresh up dengan database initialized          | DB ready/migration sesuai → API → public/admin ready; satu instance masing-masing      | Real process/health sequence       |
| D19 | P0  | Salah satu port target occupied               | Gagal sebelum start parsial; tidak kill/reuse proses asing                             | Listener identity tetap            |
| D20 | P0  | Up kedua saat daily sudah hidup               | Status existing atau refusal jelas; tidak double watcher/server                        | Process-family count               |
| D21 | P0  | Subprocess gagal setelah sebagian stack hidup | Hanya resources milik up tersebut dihentikan; volume/data bertahan                     | Process/ports + persisted rows     |
| D22 | P0  | Ctrl+C/down normal Windows                    | Owned child trees berhenti, tidak ada listeners daily yatim; preview tetap hidup       | Real Windows process lifecycle     |
| D23 | P0  | Supervisor force-killed lalu recovery         | Ownership unknown tidak dianggap aman untuk kill; reconcile sebelum restart; data utuh | Crash/recovery scenario            |
| D24 | P1  | Stop berulang / child sudah exit              | Idempotent; tidak mengenai PID yang dipakai proses lain                                | Ownership/lifecycle fault test     |
| D25 | P0  | API unhealthy sementara proses masih hidup    | Status degraded/unready; tidak melaporkan sukses hanya karena PID/port ada             | Health + status                    |
| D26 | P1  | Edit source API, public dan admin             | Hot reload bekerja; Prisma generation tidak berlomba; distDir preview/QA utuh          | Browser/runtime + directory hashes |
| D27 | P0  | Periksa listening sockets setelah up          | Public/admin/API/PG daily hanya loopback; container mode existing tetap kompatibel     | Socket inventory + targeted smoke  |

### OWNER, staff dan katalog acara

| ID  | Pri | Skenario / pemicu                                            | Expected result                                                               | Bukti utama                      |
| --- | --- | ------------------------------------------------------------ | ----------------------------------------------------------------------------- | -------------------------------- |
| D28 | P0  | First OWNER pada empty daily DB                              | Tepat satu ACTIVE OWNER, hash password; tidak ada signup endpoint             | CLI + persisted role/hash shape  |
| D29 | P0  | Bootstrap ulang ketika AdminUser sudah ada                   | Refuse, tidak reset/create/update akun existing                               | Independent persisted comparison |
| D30 | P0  | Dua bootstrap bersamaan pada DB QA kosong                    | Satu sukses, satu refuse; satu OWNER                                          | Real PostgreSQL lock/concurrency |
| D31 | P0  | Password/email invalid atau secret input tidak tersedia      | Policy existing berlaku; no default/truncation/secret log                     | Existing tests + CLI boundary    |
| D32 | P0  | OWNER membuat staff; login pertama                           | Temporary password sekali; wajib ganti sebelum scanner                        | Real browser + DB                |
| D33 | P0  | CHECKIN_STAFF membuka route/API OWNER                        | Ditolak; tidak ada dashboard/tamu/RSVP/messages/reports/staff/material access | UI + direct negative requests    |
| D34 | P0  | OWNER reset/disable staff yang punya sesi                    | Sesi dicabut; password lama tidak diterima                                    | Real browser/session persistence |
| D35 | P0  | Restart lalu login OWNER/staff                               | Akun dan password-change state tetap; tidak bootstrap ulang otomatis          | Browser + persisted accounts     |
| D36 | P0  | Initializer katalog valid pada DB fresh                      | Event dibuat atomik dengan UUID/slug/order yang sah                           | Parser + real SQL                |
| D37 | P0  | Rerun katalog identik                                        | No-op; UUID/related data tidak berubah                                        | Row comparison                   |
| D38 | P0  | Slug/order conflict atau existing event berbeda              | Refuse aman, tanpa update diam-diam/partial create                            | Transaction + unchanged rows     |
| D39 | P0  | Waktu tanpa offset, ends sebelum starts, field/file berlebih | Menolak input invalid; belum ada write                                        | Parser/domain cases              |
| D40 | P0  | Host timezone berbeda dari Asia/Jakarta                      | Instant UTC persisted sama; public/admin menampilkan WIB yang benar           | Independent pg + browser         |
| D41 | P1  | Venue/waktu belum final atau event inactive                  | Unknown tidak difabrikasi; inactive tidak eligible/scannable sesuai kontrak   | Public/admin/API assertions      |
| D42 | P0  | Seed material/contoh tersedia tetapi owner belum publish     | Draft tidak tampil ke tamu; tidak publish otomatis                            | Canonical public content read    |

### Workflow bisnis memakai API nyata

| ID  | Pri | Skenario / pemicu                                               | Expected result                                                                                    | Bukti utama                           |
| --- | --- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------- |
| D43 | P0  | OWNER membuat household dan invitees via UI                     | Persisted invitation/eligibility/invitees benar; link dapat dibuka                                 | UI + canonical/API/DB                 |
| D44 | P1  | CSV/XLSX import via workflow existing                           | Preview/selection/explicit commit; result persisted sekali, tidak menciptakan RSVP/pass lebih awal | Existing import real harness reuse    |
| D45 | P0  | Guest accept: named guest + spouse/plus one + child             | Satu additional adult, kuota/count event sah; pass berasal dari backend                            | UI + canonical RSVP + DB              |
| D46 | P0  | Accepted edit, decline dan reaccept                             | Version/lifecycle sesuai kontrak; revoked QR ditolak; tidak invent pass                            | Guest UI + staff validate + DB        |
| D47 | P0  | Pesan valid dan teks seperti script                             | Tersimpan sebagai teks; tidak dieksekusi/echo private content; staff tidak bisa membaca            | UI + DB + role negatives              |
| D48 | P0  | Draft/upload/preview lalu publish/hide pada fixture sintetis QA | Snapshot/media bertahan; draft tidak bocor; eligible guest hanya current publication               | Existing venue real E2E               |
| D49 | P0  | STAFF scan/typed QR valid                                       | Validate read-only; explicit actual/confirm; record punya operator dari sesi                       | ZXing real decode + requests + DB     |
| D50 | P0  | Scan ulang/salah event/revoked pass                             | Duplicate atau denial sesuai kontrak; tidak menambah attendance                                    | Staff UI + persisted count            |
| D51 | P0  | Dua operator confirm bersamaan                                  | Satu persisted record/pemenang; attribution benar                                                  | Two browser contexts + PostgreSQL     |
| D52 | P0  | Confirm tersimpan tetapi respons hilang                         | Uncertain → exact recovery; satu write; tidak automatic replay                                     | Network fault + authoritative DB read |
| D53 | P0  | OWNER refresh laporan/export                                    | Expected berbeda dari actual; aggregate/filter cocok DB; staff ditolak                             | UI/export + independent aggregate     |

### Persistence, backup dan recovery

| ID  | Pri | Skenario / pemicu                                   | Expected result                                                                     | Bukti utama                            |
| --- | --- | --------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------- |
| D54 | P0  | Restart API/public/admin setelah write              | RSVP/pesan/pass/attendance/material tetap; tidak reinitialize data                  | Before/after persisted comparisons     |
| D55 | P0  | Down/up PostgreSQL container tanpa menghapus volume | Dataset dan migration history tetap                                                 | Volume identity + independent SQL      |
| D56 | P0  | Restart seluruh host stack dengan secret sama       | Public URL/QR canonical sama di memori dan tetap valid sesuai lifecycle             | Browser/API + boolean/hash comparisons |
| D57 | P0  | Secret config hilang/berubah saat DB masih ada      | Tidak auto-regenerate/reissue; error/recovery jelas; data tidak dihapus             | Config identity + negative read        |
| D58 | P0  | Backup lalu restore ke database QA baru             | Counts, operator, instants, JSON publication dan media bytes sama                   | Existing real dump/restore rehearsal   |
| D59 | P0  | Restore diminta ke daily/original DB                | Workflow verifikasi menolak overwrite                                               | Negative guard + unchanged target      |
| D60 | P1  | App mati saat RSVP/check-in sedang berlangsung      | State hasil transaksi dibaca; tidak anggap request pasti gagal atau replay otomatis | Controlled fault + persisted read      |
| D61 | P0  | Cleanup fixture rehearsal dijalankan                | Hanya QA fixture miliknya dihapus; daily tidak termasuk target                      | Guard + scoped SQL                     |
| D62 | P1  | Disk/backup tool/permission gagal                   | Backup tidak diklaim sukses; kegagalan cleanup tetap dilaporkan; data asal aman     | Isolated failure injection             |

### Privacy, artifact dan handover

| ID  | Pri | Skenario / pemicu                                                                              | Expected result                                                                                                    | Bukti utama                                       |
| --- | --- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| D63 | P0  | Build context berisi marker di `.env.daily`, `.local-journey.json`, output QA/daily dan backup | Marker/file privat tidak masuk context yang dikirim atau image final                                               | Context/image inspection dengan marker sintetis   |
| D64 | P0  | Login/bootstrap/RSVP/check-in gagal termasuk unmatched public route                            | Credential, password, session/CSRF dan private input tidak bocor melalui log/error                                 | Runtime output capture + regression privacy tests |
| D65 | P0  | Supervisor status/error/diagnostics                                                            | Hanya metadata allowlist; tidak dump env/secret/argv privat                                                        | CLI output assertions                             |
| D66 | P0  | API upstream mati/invalid                                                                      | Guest mendapat safe error; tidak mock fallback, success palsu atau write queue                                     | Real request failure                              |
| D67 | P0  | Missing CSRF, wrong Origin, expired session, must-change-password                              | Denial existing tetap berlaku pada daily ports/origin                                                              | Direct API + browser tests                        |
| D68 | P0  | Real guest QR tampil pada E2E                                                                  | Tidak masuk screenshot/trace/video atau raw assertion output                                                       | Harness/artifact inspection                       |
| D69 | P1  | Config/profile berbeda antara build dan runtime                                                | Mismatch dijelaskan/ditolak; admin rewrite tidak diam-diam menunjuk API lama                                       | Built-mode smoke bila disentuh                    |
| D70 | P0  | Follow runbook dari fresh daily setup                                                          | Init/up/bootstrap/catalog/create guest dapat dilakukan tanpa menebak langkah                                       | Clean isolated rehearsal                          |
| D71 | P0  | Follow runbook pada existing daily setup                                                       | Tidak reseed/reset; up/status/down dan login bekerja                                                               | Repeated setup scenario                           |
| D72 | P0  | Source changes selesai                                                                         | Relevant unit/integration/E2E, lint/typecheck/build/format lulus; generated contract berubah hanya bila diperlukan | Exact command/results                             |
| D73 | P0  | Closing repository/asset snapshot                                                              | Original assets utuh; old edits preserved; staging/HEAD tetap kecuali user meminta commit                          | Hash + focused delta + git state                  |
| D74 | P1  | Handover tanpa perangkat fisik/hosting final                                                   | Android T12 deferred, iPhone/venue HTTPS/production tetap unknown; tidak diklaim venue-ready                       | Final report + explicit pending list              |

## 6. Urutan eksekusi dan definition of done

Urutan utama: **LD00 → LD01 → LD02 → LD03 → LD04/LD05 → LD06 → LD07 → LD09**. LD08 diaudit sejak awal dan harus ditutup sebelum build image/handover. Ini urutan dependensi, bukan instruksi menjalankan beberapa agent. Database mutations/tests yang berbagi target tidak berjalan bersamaan.

Tiga milestone:

1. **Infrastructure ready:** daily config/DB/migration/up/status/down bekerja, loopback dan isolasi terbukti; preview/QA tidak terganggu.
2. **Application ready:** OWNER/staff/katalog/tamu dan alur RSVP/pesan/QR/reporting berjalan lewat writer existing dan data persisten.
3. **Handover ready:** restart/backup/privacy/gates/runbook selesai, evidence tersimpan dan unknown fisik/produksi jelas.

Task daily selesai jika semua P0 lulus, semua P1 lulus atau memiliki gap/risiko yang eksplisit disetujui owner, dan user dapat memakai stack berulang tanpa fixture cleanup. Kegagalan environment boleh menunda gate tetapi tidak boleh ditulis sebagai pass. Uji Android tidak dimasukkan ulang ke slice ini; keputusan owner untuk menguji nanti tetap berlaku.

## 7. Perkiraan surface perubahan

| Surface                                       | Perubahan yang mungkin diperlukan                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Root `package.json`, `ops/`                   | Command daily dan supervisor/config tunggal                                                       |
| Compose daily baru / reuse komponen existing  | Hanya PostgreSQL daily/volume/loopback untuk mode hot reload; built stack existing tetap terpisah |
| `.gitignore`, `.dockerignore`, ignore tooling | Config privat, build output QA/daily, fixture/backup exclusion                                    |
| API `main.ts` / config boundary               | Optional bind-host yang tervalidasi; tidak mengubah business API                                  |
| API `scripts/`                                | Guarded local event-catalog initializer; reuse domain validation/time handling                    |
| Dua `next.config.ts`                          | Output profile generalization bila diperlukan, dengan compatibility QA/default                    |
| Tests/runbooks                                | Process lifecycle, safety guard, daily smoke/persistence dan narrow regression                    |
| Schema/OpenAPI/generated client               | Tidak diantisipasi berubah; Event CRUD/kontrak baru harus task tersendiri                         |

Target dan command awal di atas kemudian diwujudkan pada implementasi daily; perubahan aktual dan bukti ada pada verification/runbook. Checklist ini tidak memberi izin produksi.

## 8. Input dan unknown yang perlu diselesaikan saat eksekusi

- Ketersediaan Docker daemon, port daily, kapasitas disk/volume dan hak provisioning harus diperiksa saat eksekusi; sesi perencanaan tidak menguji runtime tersebut.
- Identitas OWNER dan password ditentukan owner secara privat saat bootstrap; jangan meminta password melalui chat atau menggunakan default fixture. Data tamu sungguhan tidak diperlukan untuk menutup automated daily QA.
- Materi acara final belum lengkap. Initializer menerima katalog contoh yang jelas sintetis atau materi yang sudah disetujui; nama/tanggal/venue tidak dipresentasikan sebagai final tanpa sumbernya.
- Lokasi privat backup dan mekanisme penyimpanan matching secret perlu ditetapkan. Retensi/backup hosting produksi bukan bagian dari daily local ini.
- Runtime Docker/Caddy existing, trust CA, Android/iPhone, jaringan venue dan remote CI tetap gate terpisah. Dokumentasi/config source saja belum membuktikan semuanya berjalan.
