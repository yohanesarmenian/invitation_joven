# Verifikasi development harian lokal

Tanggal: 16 Oktober 2026, Asia/Jakarta. Bukti di bawah berasal dari source yang diperiksa dan command yang benar-benar dijalankan pada mesin Windows ini. **Mode daily terimplementasi; tidak semua variasi 74 skenario sudah dibuktikan penuh.** Tidak ada commit, staging, deploy, migration baru, atau perubahan desain/foto/font pada slice ini.

Enam gap tambahan telah ditutup pada [laporan lanjutan](LOCAL-DAILY-GAPS-VERIFICATION.md): D32/D35, D44, D54, D60, D62 dan D66. Suite khusus lulus 20 kelompok termasuk CSV/XLSX nyata, crash transaksi dan backup failure; jalur default 17 kelompok/12 browser cases juga diregresi. Hasil gate awal di tabel berikut dipertahankan sebagai sejarah slice pertama; hasil lanjutan dicatat terpisah.

## Hasil yang diamati

| Gate                                      | Hasil                                                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `pnpm local:test`                         | 34/34 unit boundary tests, termasuk polling timeout tanpa background retry                                         |
| `pnpm local:lint`                         | Lulus untuk seluruh tooling daily                                                                                  |
| API test, PostgreSQL QA loopback terpisah | 39 files / 292 tests lulus; meliputi concurrency, bootstrap, auth, privacy, RSVP, pass dan check-in                |
| `pnpm --filter invitation-web test`       | 17 files / 231 tests lulus                                                                                         |
| `pnpm --filter admin-web test`            | 21 files / 306 tests lulus                                                                                         |
| `pnpm typecheck`                          | 5 workspace tasks sukses, 4 cache hit pada run penutup                                                             |
| `pnpm lint`                               | 5 workspace tasks sukses, 4 cache hit pada run penutup                                                             |
| `pnpm local:build`                        | API + kedua Next production builds lulus; output `.next-daily`, preview `.next` tidak dipakai sebagai target build |
| `pnpm local:verify`                       | 17 kelompok pemeriksaan lulus, termasuk 12 kasus browser nyata; 114.283 ms, exit 0 pada konfigurasi final Webpack  |
| `pnpm local:verify:lifecycle`             | 9 kelompok lulus, 50.560 ms, exit 0; outage DB, HMR, normal down, owner loss/recovery dan partial startup          |
| `pnpm local:verify:context`               | Scratch Docker context export nyata lulus, 12.349 ms; file privat/output/backup tidak masuk                        |
| Prettier focused slice                    | Lulus pada source/config daily dan surface aplikasi yang disentuh; bukan klaim format seluruh dirty repository     |

QA browser memakai backend nyata, origin daily dan database disposable `invitation_qa_daily_<random>`. Berhasil membuktikan:

- OWNER membuat household, named invitee, kuota dan eligibility melalui UI, lalu mengambil current public link dari UI. Tidak ada pass yang disiapkan sebelum RSVP.
- Guest accept/edit/decline/reaccept, satu shared spouse/plus-one, anak, pesan, pass dari backend, dan QR camera sintetis ZXing.
- Staff validate/confirm, duplicate denial, dua operator bersamaan, lost confirmation recovery tanpa second write, manual exact-status recovery dan attribution operator.
- Reports/export cocok persisted data; password reset/disable mencabut sesi staff, must-change-password berlaku.
- Draft/upload/preview/publish/hide materi acara serta lost-save response recovery pada QA.
- Full stop/start aplikasi dan PostgreSQL mempertahankan hash RSVP, attendees/event selections, message, pass, check-in/operator/timestamp; QR canonical dibandingkan hanya dalam memori.
- Real PostgreSQL 18 dump/restore rehearsal existing memeriksa data/media/publication pada database restore QA berbeda. Tidak restore ke daily.
- Daily config hash dan minimal counts dataset pengguna tetap sama. Guard destructive tests menolak database `invitation_daily` walaupun opt-in test flag aktif.
- Migration checksum mismatch dan marker secret/profile berbeda ditolak sebelum app startup. Katalog rerun identik no-op; perubahan katalog ditolak dengan semua event row tetap identik.

Daily yang disiapkan berisi **0 AdminUser dan 2 acara development sintetis**. First OWNER harian sengaja belum ditanam: owner memilih email/password sendiri melalui `pnpm local:owner` di terminal privat. Tidak ada tamu sungguhan yang diimpor. Tanggal/venue katalog contoh tetap null; materi final tidak dibuat-buat.

Saat handover, `local:status` menunjukkan **ready**, tiga worker hidup, dan independent SQL menunjukkan admins=0/events=2/invitations=0. Socket inventory Windows memverifikasi public 3200, admin 3201, API 4200, control 4201 dan PostgreSQL 55433 hanya listen pada `127.0.0.1`. Preview lama 3000/mock 4010 juga tetap listen. Daily dibiarkan aktif untuk pemakaian lokal; jalankan `local:owner` secara privat untuk membuat akun pertama.

API suite dijalankan melalui helper privat existing `node D:\Projects\rea\.cache\jo-venta-journey\run-qa.cjs --filter api test`, yang menetapkan database QA loopback port 5433 `invitation_qa_20261016_journey` dan opt-in guards. Ini bukan command untuk database harian. Full workflow final memeriksa configured secret/password tidak ada dalam captured log, tidak ada query parameter password, dan artifact browser hanya `.last-run.json`. Post-init preflight Docker diuji langsung: resources existing menolak replacement-profile creation, private config hash tetap; `local:init` ulang sesudahnya juga lulus.

## Implementasi dan batasnya

| Paket | Implementasi / status                                                                                                     |
| ----- | ------------------------------------------------------------------------------------------------------------------------- |
| LD00  | Baseline 577 file, HEAD/branch/staging dicatat; worktree awal sudah dirty                                                 |
| LD01  | Parser config tunggal, random secret sekali, idempotent init, private DACL/mode, flags QA disanitasi                      |
| LD02  | Container/volume loopback khusus, app role NOSUPERUSER/NOCREATEDB/NOCREATEROLE; empat migration existing                  |
| LD03  | Native supervisor + IPC ownership, authenticated status/down/recovery, API watcher dan Next HMR                           |
| LD04  | Official bootstrap CLI wrapper siap; synthetic bootstrap/concurrency/auth diuji di QA; akun harian menunggu input privat  |
| LD05  | JSON catalog initializer operator-only, bounded/strict/atomic/no silent update                                            |
| LD06  | Workflow UI/API existing direhearsal dengan database QA disposable; tidak menulis fixture bisnis ke daily                 |
| LD07  | Full restart comparison + actual QA dump/restore; bukan sistem backup harian otomatis                                     |
| LD08  | Git/Docker/Prettier exclusions, real build-context audit, no guest QR media artifacts; production final image belum diuji |
| LD09  | Commands, runbook, evidence matrix, closing repository/asset check; unknown dicatat                                       |

Tidak ada Event CRUD endpoint/UI baru. Katalog final berbeda dari katalog contoh memerlukan operator/Event-management slice tersendiri. `assertMigrations` memeriksa history, checksum, finished/rolled-back status; **bukan pemeriksaan penuh arbitrary SQL schema drift**. Provisioning yang terputus antara CREATE DATABASE dan COMMENT dapat meninggalkan identity unresolved; workflow menolak dan mempertahankan data.

Supervisor tidak mematikan proses berdasarkan PID/port. Shutdown menggunakan child handles/IPC ack. Manifest cleanup yang tidak diakui dipertahankan, explicit recovery mensyaratkan port bebas dan database identity sesuai lalu menyimpan riwayat. Malformed manifest tetap ditolak. Command capture menunggu stdio close, membatasi output, dan tidak menganggap command gagal yang salah sebagai expected refusal. Worker menunggu API lama benar-benar exit sebelum generasi baru dimulai.

## Pemetaan 74 skenario

**V** = bukti runtime/boundary yang disebut dijalankan; **P** = sebagian acceptance/variasi belum dieksekusi, bukan pass penuh; **D** = sengaja ditunda/input owner. Tes existing yang disebut di sini dijalankan ulang; tidak semua dijalankan di database daily pengguna. Referensi ID dan expected lengkap ada di task document.

| ID  | Status | Bukti / batas                                                                                                             |
| --- | ------ | ------------------------------------------------------------------------------------------------------------------------- |
| D01 | V      | Baseline dan closing hash/HEAD/index; perubahan lama dipertahankan                                                        |
| D02 | P      | Preview 3000/mock 4010 tetap hidup; tidak ada klaim snapshot seluruh proses/data QA lama                                  |
| D03 | P      | CLI ditemukan di bundled Docker path; daemon 29.6.2 tersedia. Daemon mati belum fault-injected                            |
| D04 | V      | Unsupported DB/host config ditolak parser; real marker mismatch ditolak sebelum workers                                   |
| D05 | P      | Missing-config refusal ada pada loader; file privat pengguna tidak dipindah untuk fault test                              |
| D06 | V      | Fresh init dan rerun, empat migrations/no pending, config hash tetap                                                      |
| D07 | V      | Invalid secret/password placeholders ditolak unit boundary; output redaction assertions                                   |
| D08 | V      | Host/URL override tidak didukung; invalid/distinct ports diuji sebelum side effect                                        |
| D09 | V      | Daily environment menimpa flags destructive/workflow dan bootstrap ambient                                                |
| D10 | P      | Default daily origins/rewrite/current link terbukti nyata; variasi custom ports belum dijalankan                          |
| D11 | V      | Dedicated container/volume, actual database identity dan non-superuser role                                               |
| D12 | V      | Empat migrations diterapkan fresh dan diverifikasi checksum                                                               |
| D13 | V      | Init ulang tidak mengganti secret/catalog; no pending migrations                                                          |
| D14 | P      | Real checksum mismatch ditolak; arbitrary schema drift/failing migration DDL belum diuji                                  |
| D15 | V      | Real DB outage lifecycle dan wrong-password connection ditolak dengan error aman tanpa fallback                           |
| D16 | V      | Actual test runner menolak daily dengan diagnostic guard yang tepat, bukan arbitrary nonzero                              |
| D17 | P      | Target mutation hardcoded daily/owned QA, DB kerja tidak ditargetkan; tidak ada before/after seluruh dataset kerja        |
| D18 | V      | Actual native API + Next + PostgreSQL startup/health                                                                      |
| D19 | V      | Foreign listener dipertahankan; startup menolak konflik                                                                   |
| D20 | V      | Owner kedua refuse, tidak mengambil alih instance                                                                         |
| D21 | V      | Foreign admin listener disisipkan setelah preflight; own partial startup dibersihkan                                      |
| D22 | P      | Authenticated down Windows dan port cleanup lulus; physical terminal Ctrl+C belum direhearsal                             |
| D23 | V      | Owned supervisor ChildProcess dihentikan paksa; IPC children release; unknown → explicit recovery, zero PID kills         |
| D24 | P      | Normal down/child-loss lulus; seluruh variasi repeated-stop/PID-reuse belum dieksekusi                                    |
| D25 | V      | Worker tetap hidup saat PostgreSQL outage, status degraded; kembali ready sesudah restore service                         |
| D26 | P      | API reload dan kedua browser HMR nyata; hash seluruh generated preview/QA directories bukan acceptance yang diperiksa     |
| D27 | V      | Socket inventory daily hanya 127.0.0.1, termasuk PostgreSQL; preview tetap ada                                            |
| D28 | D      | Official bootstrap lulus pada empty QA; akun harian menunggu identitas/password privat owner                              |
| D29 | V      | CLI bootstrap ulang menolak; satu record tetap, existing tests memeriksa password hash tidak berubah                      |
| D30 | V      | Real PostgreSQL concurrent bootstrap existing test, tepat satu OWNER                                                      |
| D31 | P      | Existing password policy + no-input terminal refusal tersedia; semua terminal cancel/paste boundary belum diuji           |
| D32 | V      | OWNER membuat staff melalui UI, temporary password sekali, first login/ganti password/scanner nyata; lihat laporan gap    |
| D33 | V      | Role route/unit dan real API negatives; staff reports/owner access ditolak                                                |
| D34 | V      | Real browser reset/disable mencabut sesi staff                                                                            |
| D35 | V      | Staff baru must-change-password=true dan hash bertahan setelah restart, login/change/scanner lulus; OWNER login regresi   |
| D36 | V      | Real fresh catalog init dalam transaction                                                                                 |
| D37 | V      | Rerun identical no-op; real row hash stable                                                                               |
| D38 | V      | Changed existing catalog refuses, real all-row hash tidak berubah; duplicate slug/order parser negatives                  |
| D39 | V      | Offset/date/ends/field/count/size parser negatives                                                                        |
| D40 | P      | ISO offset canonicalization unit + existing timezone tests; catalog init di dua process TZ belum dijalankan               |
| D41 | P      | Null date/venue preserved; inactive denial existing backend tests, bukan seluruh variasi catalog browser                  |
| D42 | V      | Daily tidak auto-publish; real draft/public snapshot access E2E                                                           |
| D43 | V      | OWNER browser membuat household/invitee/quota/event; independent persisted read dan current UI link                       |
| D44 | V      | Dua real CSV/XLSX browser cases, preview/selection/commit/lost-response recovery dan independent SQL                      |
| D45 | V      | Real guest shared additional adult/child, canonical RSVP dan backend pass                                                 |
| D46 | V      | Accept edit/decline/reaccept, pass retention/revocation/new issuance                                                      |
| D47 | P      | Real message persisted + text rendering/auth regression; script-like message payload browser belum ulang pada daily       |
| D48 | V      | Real draft/upload/preview/publish/hide, guest snapshot/media denial                                                       |
| D49 | V      | Synthetic camera real ZXing decode + typed QR + real validate/confirm/operator                                            |
| D50 | V      | Duplicate/revoked/wrong event negatives dari real browser/API suite                                                       |
| D51 | V      | Dua real browser contexts + PostgreSQL, satu persisted check-in                                                           |
| D52 | V      | Network response loss setelah write, exact recovery, tidak second write                                                   |
| D53 | V      | Real reports/export aggregate/filter assertions                                                                           |
| D54 | V      | Full restart kini membandingkan draft/publication/assets/staff hash serta public media bytes, selain data RSVP/check-in   |
| D55 | V      | PostgreSQL down/up, volume dan dataset bertahan                                                                           |
| D56 | V      | Full owned app+DB restart, secret sama, canonical QR sama; bukan OS reboot                                                |
| D57 | P      | Real identity mismatch refuses; file secret pengguna tidak dihapus/diubah untuk fault injection                           |
| D58 | V      | Actual dump/restore PG18: counts/operator/instants/publication/media                                                      |
| D59 | V      | Actual transport dipanggil dengan target daily: exact refusal sebelum spawn/write; counts daily tetap                     |
| D60 | V      | Dua actual API process kills sesudah INSERT RSVP/check-in sebelum commit; rollback, authoritative read, explicit retry    |
| D61 | V      | QA exact-name cleanup, unchanged daily minimal counts/config; destructive test guard                                      |
| D62 | V      | Actual missing tool, OS write denial dan Windows held-file cleanup failure/recovery lulus; disk-full tetap unknown        |
| D63 | P      | Actual Docker context scratch export bersih; final production image/layers tidak diperiksa                                |
| D64 | P      | Existing API privacy regressions + bounded/redacted daily logs; bukan audit universal seluruh failure combinations        |
| D65 | V      | Status metadata allowlist/auth, config secret output assertions dan captured logs                                         |
| D66 | V      | Actual API mati saat guest RSVP/pesan; safe error/uncertain, input tetap, no pass/write/auto replay, retry eksplisit satu |
| D67 | V      | Real API auth/CSRF/Origin/session negatives + first-login browser enforced                                                |
| D68 | V      | Playwright screenshot/trace/video off, copy-prompt DOM snapshot suppressed; artifacts diperiksa                           |
| D69 | P      | Both isolated Next builds pass with derived config; built runtime custom-origin mismatch smoke belum dijalankan           |
| D70 | P      | Fresh init/bootstrap-QA/catalog/UI workflow lulus dalam bagian terpisah; belum human fresh-machine rehearsal              |
| D71 | P      | Repeated init/up/down lulus; daily login menunggu OWNER                                                                   |
| D72 | V      | Relevant tests/typecheck/lint/build/focused format; generated contract unchanged terhadap baseline slice                  |
| D73 | V      | Closing focused delta, protected file hashes, same HEAD dan empty index                                                   |
| D74 | D      | Android fisik ditunda owner; iPhone, venue HTTPS/LAN dan hosting/production tetap unknown                                 |

P/D di atas tetap backlog verifikasi, bukan otomatis disetujui sebagai exception semua P0. Definition of done 74-scenario penuh belum diklaim. Infrastruktur dan alur otomatis utama siap dipakai lokal; first OWNER dan rehearsal perangkat adalah langkah user selanjutnya.

## Kegagalan yang ditemukan dan diperbaiki

Run awal menemukan cwd Next admin salah (relative config import), dynamic import path Windows perlu file URL, backup helper perlu cwd API, Vitest CLI perlu entrypoint package yang benar, dan Windows ACL tidak boleh meminta WRITE_OWNER. Semuanya diperbaiki di boundary pemiliknya dan gate relevan dijalankan ulang. Dashboard rehearsal menemukan relation Prisma `invitationEvents` dan textarea public link harus dibaca melalui `inputValue`. HMR harness perlu menunggu asynchronous route discovery. Polling sekarang memiliki batas loop sendiri, sehingga timeout tidak meninggalkan retry/timer di background. Failure harness ini tidak diklaim sebagai bug bisnis aplikasi.

Real owner-loss rehearsal menemukan proses transform CSS Turbopack tetap hidup meskipun listeners sudah ditutup. Run awal yang mencetak assertion sukses tetapi CLI belum exit **tidak dianggap gate penuh lulus**. Sesi tool milik run tersebut dihentikan melalui handle session, tanpa kill PID asing. Next custom-server memakai opsi `webpack: true` yang diperiksa pada source/type installed Next 16.3.5. Run final sembilan kelompok selesai exit 0; tidak ada Node transform-pool process tersisa.

Browser real juga mengamati native GET form ganti password sebelum hydration, sehingga password sintetis QA masuk query URL/log. Form kini menyatakan POST dan input/submit disabled hingga client readiness; React server snapshot mempertahankan proteksi sebelum event handlers siap. Browser tanpa JavaScript membuktikan fields/button disabled dan method POST, sedangkan real password-reset/change flow lulus. Akun/password yang terlibat berasal dari QA disposable, bukan akun harian pengguna. Ini perbaikan privasi fungsional pada `password-change-form.tsx`, tanpa perubahan desain.

Log cleanup/command failures tidak dianggap pass. Output success verifier ditulis setelah cleanup. Private recovery metadata dipertahankan bila cleanup tidak selesai. Error PostgreSQL dan transport tidak mencetak password/URL privat. Tidak ada SQL reset/wipe harian sebagai perbaikan.

## Bukti privat, performa, dan unknown

Closing snapshot dibandingkan baseline 577 file: **72 file aset public/original tetap sama hash**. Schema Prisma, migration source, OpenAPI, generated client, lockfile, Turbo config dan CI source tetap sama terhadap baseline slice; beberapa file tersebut sudah dirty sebelum task ini. HEAD tetap `6bb089bf89ca36752c87a20d6625519101f3b42e`, branch `fix/checkin-manual-status-reconciliation`, index kosong. `next-env.d.ts` kedua app berubah otomatis ke output `.next-daily`; output generated tidak distage. Diff check lulus. Daftar perubahan slice dan hash evidence ada di `closing.json` privat, bukan disimpulkan dari seluruh diff HEAD yang memuat pekerjaan lama.

Ringkasan lokal privat berada di `.local-daily/{verification,lifecycle-verification,context-verification}.json`. Baseline/log command berada di `D:\Projects\rea\.cache\invitation-daily`. Jangan commit folder bukti/private config. Warning fallback font TikTok Sans dan warning pg concurrency yang sudah ada diamati; tidak diperbaiki sebagai bagian tooling daily.

Elapsed completed run di mesin ini: final real workflow **114,283 detik** (17 kelompok, Webpack, warm compilation), final lifecycle **50,560 detik**, API suite **34,97 detik**, context export awal **12,349 detik** dan warm rerun **2,937 detik**. Run Turbopack sebelumnya memiliki coverage/bundler berbeda, sehingga bukan baseline performa ekuivalen. Cold/warm tidak dibenchmark sistematis. Token seluruh task, CPU time dan peak process-family memory **tidak diukur**; tidak ada klaim penurunan freeze, biaya, atau performa sebelum/sesudah. Penyebab ChatGPT freeze sebelumnya tidak didiagnosis.

Belum dibuktikan: OS reboot/power loss/disk full, physical Ctrl+C, malformed manifest recovery, full SQL schema drift detection, final image/Caddy HTTPS runtime, remote CI, Android/iPhone kamera fisik, jaringan venue, production backup/retention/deployment, dan materi acara final. Tidak ada data/data asset Katsudoto atau akun pengguna lain yang diakses untuk implementasi ini.
