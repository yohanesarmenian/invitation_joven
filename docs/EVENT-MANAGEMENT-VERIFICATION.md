# Verifikasi Pengelolaan Acara

Tanggal: 16 Oktober 2026, Windows, local daily PostgreSQL 18. Implementasi mencakup editor OWNER, perlindungan referensi/jadwal, dan tanggal/countdown/calendar yang bersumber dari backend. Bukan deployment produksi.

## Hasil yang dijalankan

| Gate                                                                                                                        | Hasil                                                                                |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `pnpm api:contract:generate`                                                                                                | OpenAPI dan client berhasil dihasilkan; existing catalog DTO dipertahankan           |
| `pnpm typecheck`                                                                                                            | 5 task workspace lulus                                                               |
| `pnpm lint`                                                                                                                 | 5 task workspace lulus, tanpa warning                                                |
| `pnpm local:lint`                                                                                                           | Lulus                                                                                |
| `pnpm local:build`                                                                                                          | API + dua Next production build lulus, output `.next-daily` terpisah                 |
| `pnpm local:verify:events`                                                                                                  | 12 kelompok pemeriksaan lulus, 64.301 detik termasuk startup/cleanup                 |
| PostgreSQL dalam runner                                                                                                     | 96 tes lulus pada 7 file, termasuk 8 kasus Event management baru dan kontrak OpenAPI |
| Browser dalam runner                                                                                                        | 4 kasus Chromium sungguhan lulus, backend dan PostgreSQL nyata                       |
| `pnpm --filter admin-web test`                                                                                              | 312 tes, 22 file lulus                                                               |
| `pnpm --filter invitation-web test -- components/invitation/public-invitation-long-page.spec.tsx src/events/events.spec.ts` | Script menjalankan seluruh suite: 232 tes, 17 file lulus                             |
| `pnpm local:test`                                                                                                           | 38 tes tooling lulus                                                                 |

Raw report privat: `.local-daily/verification-events.json` dan `.local-daily/events-api-results.json`. Screenshot editor mobile memakai akun/data sintetis di `.local-daily/events-editor-mobile.png`; tampilannya ditinjau dan pemeriksaan overflow viewport 390×844 lulus. Jangan membagikan diagnostics mentah karena dapat berisi konteks fixture/session.

## Bukti perilaku

Pemeriksaan format terpisah: seluruh 33 file sumber dalam diff slice ini yang didukung Prettier lulus (SQL/Prisma dan output generator dikecualikan). `pnpm format` tingkat root **belum lulus**: 71 file diperingatkan, terdiri dari 69 file yang hash-nya sama dengan baseline dan dua output regenerasi (`apps/api/openapi.json`, `packages/api-client/src/generated/schema.ts`) dengan format bawaan generator. Tidak dilakukan autoformat seluruh repo atau perubahan pipeline generator. `git diff --check` lulus.

Snapshot penutupan: branch `fix/checkin-manual-status-reconciliation`, HEAD `6bb089bf89ca36752c87a20d6625519101f3b42e`, index kosong. Daily siap di localhost:3200/3201; API generation 1. Database daily berisi 0 admin, 2 acara mock, 0 undangan/RSVP/check-in dan 5 migrasi. OWNER nyata belum dibuat; jalankan `pnpm local:owner` secara privat sebelum memakai editor. Identitas QA terverifikasi sudah tidak ada di `pg_database`. Preview lama port 3000/4010 masih memakai PID baseline; PostgreSQL 5433 tetap mendengarkan.

- OWNER dapat create/edit dan reload field yang tersimpan; field kosong tetap null. Slug/order duplikat dan 14 variasi payload invalid ditolak tanpa perubahan row.
- Dua penyimpanan dengan version sama menghasilkan satu sukses dan satu 409; row akhir sesuai pemenang. Draft tab yang kalah dipertahankan dan perlu reload eksplisit.
- PostgreSQL lock waiter diamati melalui `pg_blocking_pids`: creation invitation menunggu Event mutation lalu menolak acara yang baru dinonaktifkan; management menunggu commit link lalu menolak deactivation; staff confirmation menunggu Event lock, lalu check-in membuat jadwal terkunci.
- Referensi undangan archived tetap melindungi acara. Koreksi nama/tempat tidak mengubah RSVP tersimpan. Suite check-in/import/eligibility/content existing juga lulus.
- Input OWNER `2028-02-11 00:30 WIB` tersimpan sebagai `2028-02-10T17:30:00.000Z`. Undangan menampilkan 11 February 2028, jam 00.30, venue/Maps terbaru, countdown yang berubah, serta kalender `DTSTART:20280210T173000Z`.
- Respons PUT sengaja diputus setelah backend commit: browser tidak replay, version bertambah tepat satu, form terkunci dan canonical reload memulihkan state.
- Staff ditolak pada API editor dan diarahkan dari `/events` ke `/checkin`; schedule field OWNER disabled sesudah check-in.

## Perbaikan selama verifikasi

Tes awal memakai lokasi kode error/field katalog dan selector status yang salah; assertion diperbaiki mengikuti envelope/catalog existing. Browser menemukan overflow nyata pada form baru, diperbaiki dengan constraint fieldset/select dan style form existing. Runner Event baru awalnya masuk pemeriksaan konflik port sebelum shutdown, lalu perlu menyalakan kembali database setelah shutdown untuk pemeriksaan lanjutan; kedua urutan diperbaiki. Identitas QA dari crash pertama direkonsiliasi melalui recovery resmi dan database QA exact dihapus setelah marker/port diverifikasi, tanpa kill berdasarkan PID.

Suite API kini dijalankan sebelum memulai watcher aplikasi; browser berjalan sesudah startup. Pengujian akhir selesai dengan cleanup berhasil. Tidak ada klaim bahwa semua percobaan awal lulus.

## Persistence, scope dan batas

Migration `20261016090000_event_management` diterapkan pada database daily milik workflow dan QA. Perubahan schema hanya penambahan `events.version` default 1. Runner membuktikan private config dan jumlah row dataset daily tidak berubah selama rehearsal. Pengujian destruktif tidak memakai database daily atau database kerja lama di port 5433.

Seluruh 72 file foto/design di public assets dan `gambar-edit` cocok SHA-256 dengan baseline sesi. OpenAPI, generated client dan schema berubah sesuai scope; lockfile, Turbo dan CI tidak berubah dari baseline. Worktree sudah dirty sebelum slice; perubahan lama dipertahankan. Tidak ada staging/commit/deployment.

Belum diuji dalam slice ini: Android/iPhone fisik, runtime produksi/container HTTPS, load besar, push update ke tab tamu yang sudah terbuka, backup data harian nyata, materi final dan perubahan rundown otomatis. Description Event belum diproyeksikan publik. Waktu CPU/peak memory dan biaya lock pada beban venue belum diukur; durasi di atas adalah wall-clock QA, bukan benchmark performa.
