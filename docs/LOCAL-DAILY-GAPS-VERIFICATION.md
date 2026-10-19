# Penutupan enam gap verifikasi daily

Tanggal: 16 Oktober 2026, Asia/Jakarta. Enam task yang disetujui telah dikerjakan dan diuji pada **database QA disposable**, dengan API/PostgreSQL nyata. Tidak ada reset/migration baru pada data harian, pembuatan OWNER harian default, perubahan desain/foto/font, staging, commit atau deployment.

## Hasil dan test case

| Task / ID awal                               | Skenario yang benar-benar dijalankan                                                                                                    | Expected dan hasil yang diamati                                                                                                                                                               |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Staff baru — D32                             | OWNER mengisi email dan Create staff account melalui UI                                                                                 | Satu CHECKIN_STAFF persisted, hash Argon2id, mustChangePassword=true; temporary credential muncul, hilang setelah reload                                                                      |
| First login/restart — D35                    | Seluruh app dan PostgreSQL down/up; staff login dengan temporary credential                                                             | State/password hash tetap sama; diarahkan ke ganti password. Validate dengan sesi dan CSRF valid ditolak 403 sebelum perubahan password                                                       |
| Scanner sesudah perubahan password — D32/D35 | Staff mengganti password melalui UI, memilih event, typed QR lalu Validate                                                              | Scanner terbuka, validate berhasil, mustChangePassword=false persisted; belum ada check-in write                                                                                              |
| CSV — D44                                    | Upload/preview, warning acknowledgement, memilih baris, explicit commit, respons commit dibuat gagal setelah backend commit             | Persisted tepat satu batch; recovery eksplisit tidak menduplikasi invitations/invitees. Preview tidak membuat RSVP/pass; inactive event ditolak                                               |
| XLSX — D44                                   | XLSX dibuat helper existing lalu di-upload dan di-commit melalui UI                                                                     | Real backend contract terpenuhi; household/invitees/eligible events tersimpan sesuai isi workbook                                                                                             |
| Materi — D54                                 | OWNER membuat parking/rundown, upload PNG, save/publish, lalu menyimpan draft edit yang belum dipublish                                 | Draft dan publication berbeda sesuai keputusan OWNER; tidak auto-publish edit                                                                                                                 |
| Persistence materi — D54                     | Full stop/start aplikasi dan PostgreSQL                                                                                                 | Hash seluruh row content/assets/staff identik; guest tetap membaca judul published, bukan draft. Byte media publik SHA-256 sama dengan file upload                                            |
| API mati — D66                               | Undangan dimuat saat API hidup, kemudian **proses API dihentikan** sebelum submit RSVP dan pesan                                        | UI menampilkan error/uncertain yang aman, input tetap ada, QR tidak muncul; SQL menunjukkan RSVP/pass/message belum tercipta                                                                  |
| API pulih — D66                              | API dinyalakan kembali, tanpa klik retry selama 1,2 detik, kemudian retry eksplisit                                                     | Tidak ada queued write pada jendela observasi; setelah klik user, tepat satu RSVP, pass, dan message persisted                                                                                |
| Crash RSVP — D60                             | Actual production INSERT ditahan di dalam transaction PostgreSQL QA; API ChildProcess dihentikan paksa sebelum commit                   | Request tidak memberi sukses, row RSVP rollback dan pass tidak tercipta; authoritative GET null. Retry eksplisit menyimpan version=1 dan satu pass                                            |
| Crash check-in — D60                         | Actual checkin_records INSERT ditahan sebelum commit; proses API dihentikan paksa                                                       | Row rollback, exact manual-status membaca NOT_CONFIRMED. Satu explicit confirm berikutnya menghasilkan satu record dengan operator sesi/count yang benar                                      |
| Tool backup hilang — D62                     | Existing backup rehearsal dipanggil dengan entrypoint dump yang sengaja tidak tersedia                                                  | Actual command gagal dengan diagnostic pg_dump yang diharapkan, tanpa RESTORE_VERIFIED; restore DB/fixture dibersihkan dan hash sumber tidak berubah                                          |
| Write permission backup — D62                | Direktori privat milik run diberi DACL read/execute; write probe dan dump sungguhan dicoba                                              | OS benar-benar menolak EACCES/EPERM; dump tidak diklaim sukses, source hash tetap; DACL dipulihkan sebelum cleanup                                                                            |
| Cleanup gagal — D62                          | ChildProcess PowerShell milik test membuka file Windows tanpa delete sharing; workflow cleanup yang sama mencoba menghapus direktorinya | Actual remove gagal; metadata CLEANUP_PENDING menyimpan identitas direktori tepat. Setelah handle ditutup, explicit reconciliation hanya menghapus direktori milik run dan pending marker-nya |

Import menggunakan dua browser tests existing `import-real.e2e.ts`, bukan response mock. Fault pada respons CSV dilakukan **setelah** request benar-benar mencapai dan menyimpan data di backend. Pembuatan staff, upload/publication, guest submit dan password change juga menggunakan UI serta backend nyata.

## Cara menjalankan

API compiled diperlukan oleh fixture existing. Dari root project, jalankan berurutan:

```powershell
pnpm local:down
pnpm local:build
pnpm local:verify:gaps
pnpm local:verify
pnpm local:up
```

Jangan menjalankan kedua verifier bersamaan: keduanya memakai port daily dan membuat QA DB masing-masing. Verifier tidak mengambil alih owner yang sedang hidup/unknown. Profil daily dihentikan sementara untuk memakai port yang sama; data/volume harian dipertahankan. Preview 3000/mock 4010 bukan target workflow ini.

`local:verify:gaps` berbagi provisioning, identity checks, secret/migration guard dan cleanup QA dengan verifier utama. Hanya pilihan suite yang berbeda. Hasilnya disimpan terpisah di `.local-daily/verification-gaps.json`; hasil verifier utama tetap `.local-daily/verification.json`. Tidak ada fallback ke database `.env` kerja atau API mock.

## Mekanisme fault dan kepemilikan

- Crash tidak memakai mock exception atau test endpoint pada aplikasi. Harness membuat temporary PostgreSQL trigger **hanya di DB QA yang tepat**, dengan UUID household tertentu dan advisory lock unik. `pg_stat_activity` membuktikan koneksi API dengan application_name milik run sedang menunggu lock di transaction sesudah INSERT. ChildProcess handle yang dibuat harness kemudian dihentikan; tidak ada pencarian/kill PID asing.
- RSVP crash diuji sesudah INSERT RSVP, sebelum pembuatan pass selesai. Check-in crash diuji sesudah INSERT record. Ini dua interleaving tertentu; bukan klaim semua titik transaksi/power-loss telah diuji.
- Standalone API compiled dan public Next worker dipakai pada fase outage/crash agar harness memiliki handle API yang dihentikan. Kode bisnis, database, secret, port dan upstream tetap nyata; perbedaan ini tidak disamakan dengan uji owner-loss supervisor yang sudah dicatat terpisah.
- Trigger/function/lock dilepas dalam cleanup. Verifier memeriksa semua app/control ports bebas sebelum drop QA. Jika readiness/ownership/cleanup tidak dapat dipastikan, run gagal dan QA identity dipertahankan untuk recovery.
- Normal backup-directory cleanup dan kasus held-file memakai owner cleanup yang sama: batas private UUID diverifikasi sebelum recursive removal, pending metadata tidak ditimpa bila identity unresolved, dan recovery harus eksplisit.
- Backup tool failure memeriksa seluruh hash row pada 13 tabel bisnis, termasuk media/publication dan akun. Existing restore DB names dibandingkan sebelum/sesudah; tidak ada drop berdasarkan prefix terhadap resource lain.

## Validasi yang dijalankan

| Gate                            | Hasil                                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm local:verify:gaps`        | **20 kelompok lulus, 82.521 ms, exit 0**, termasuk dua CSV/XLSX browser tests dan semua kasus di atas                                                              |
| `pnpm local:verify`             | **17 kelompok / 12 browser cases lulus**, 110.769 ms, exit 0; regresi jalur default sesudah penambahan pilihan suite/guard cleanup                                 |
| `pnpm local:test`               | **38 tests lulus**: 34 existing + empat negative cases yang memastikan fault runners menolak daily/postgres/QA yang tidak dimiliki sebelum mengalokasikan resource |
| `pnpm local:lint`, `pnpm lint`  | Lulus                                                                                                                                                              |
| `pnpm typecheck`                | Lulus                                                                                                                                                              |
| Focused Prettier dan diff check | Dicatat pada snapshot penutup                                                                                                                                      |

Run awal gagal karena harness mengharapkan pesan definite failure, sedangkan kontrak existing mengembalikan **uncertain** ketika koneksi submit pesan terputus. Ekspektasi diperbaiki sesuai source/observasi, tanpa mengubah API menjadi success atau menambahkan retry otomatis. Run lengkap kemudian lulus. Ini koreksi harness, bukan bug aplikasi yang diklaim ditemukan/diperbaiki.

Durasi di atas adalah completed warm runs pada mesin ini. Coverage kedua verifier berbeda sehingga angkanya bukan perbandingan performa ekuivalen. Cold runs, CPU time, peak process-family memory dan jumlah token tidak diukur. Warning pg concurrent-query/font yang sudah ada tidak diubah dalam slice ini.

## Cakupan yang tetap belum terbukti

Enam task ini ditutup untuk skenario yang tertera, **bukan seluruh 74 variasi awal**. Disk penuh, OS reboot/power loss, semua kemungkinan timing transaksi, universal cleanup failure pada setiap resource, production image/Caddy/HTTPS, remote CI dan perangkat Android/iPhone fisik belum dibuktikan. File-lock cleanup dan DACL permission fault di atas dibuktikan pada Windows ini; hasil POSIX tidak diasumsikan sama.

First OWNER harian tetap dibuat sendiri melalui terminal privat bila belum ada. Materi/tanggal/venue final belum ditentukan dan Event CRUD belum diimplementasikan. Android tetap ditunda sesuai keputusan owner. Detail status keseluruhan ada di `LOCAL-DAILY-DEVELOPMENT-VERIFICATION.md`.

Raw output/baseline/closing snapshot berada di `D:\Projects\rea\.cache\invitation-daily-gaps`; ringkasan QA berada di `.local-daily`. Artifacts/config/credential privat tidak distage atau dikomit. QR, password sementara dan cookie hanya dipakai dalam memori browser/request; tidak dibuat screenshot/trace/video pada suite ini.

Snapshot penutup membandingkan **607 file baseline**: perubahan hanya pada lima file existing (runner, package script, metadata origin import helper, dua dokumen) dan enam file baru (config suite, tiga rehearsal modules, guard tests, laporan ini). **72 aset public/original identik**, schema/OpenAPI/generated client/lockfile/Turbo/CI tetap sama terhadap baseline, HEAD `6bb089bf89ca36752c87a20d6625519101f3b42e` dan staging kosong. Focused Prettier/diff check lulus. Tidak ada production app business source yang berubah pada slice ini.

Handover: daily **ready** kembali pada 3200/3201/4200, seluruh daily sockets hanya `127.0.0.1`; preview 3000/mock 4010 tetap hidup. Independent SQL daily menunjukkan admins=0/events=2/invitations=0, sama dengan awal. Config-secret/password-query scan output final lulus; tidak ada direktori atau pending marker backup gap tersisa. Artifact import hanya `.last-run.json` dan workbook sintetis XLSX, tanpa screenshot/trace/video.
