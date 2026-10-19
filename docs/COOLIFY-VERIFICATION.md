# Verifikasi persiapan CI/CD Coolify

Tanggal: 16 Oktober 2026. Implementasi dan verifikasi dilakukan di workspace lokal; GitHub Actions dan server Coolify belum menjalankan konfigurasi ini pada saat pencatatan. SHA dan status working tree di bawah merekam penutupan slice sebelum checkpoint Git, bukan status branch terbaru. Sebelum checkpoint, source branch CI/CD diselaraskan ke default remote `master`; 13 test tooling dan actionlint lulus kembali. File `next-env.d.ts` admin menjadi output ignored, dan typecheck admin menjalankan `next typegen` terlebih dahulu; gate ini juga lulus.

## Hasil final

| Gate                                   | Hasil yang dieksekusi                                                                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm deploy:test`                     | 13 test lulus: batas promosi, identitas SHA/repo/ref, CI gagal, stale auto promotion, fast-forward, respons hilang, permission/privacy, dan rendering Compose |
| `pnpm deploy:lint`                     | Lulus                                                                                                                                                         |
| actionlint v1.7.12                     | Kedua workflow lulus; ShellCheck dinonaktifkan pada Windows. Binary official diunduh privat dan checksum release diverifikasi                                 |
| Admin route regression                 | 21 test lulus pada `invitation-routes.test.tsx` dan `rsvp-routes.test.tsx`                                                                                    |
| `pnpm --filter admin-web typecheck`    | Lulus                                                                                                                                                         |
| `pnpm --filter admin-web lint`         | Lulus                                                                                                                                                         |
| `pnpm deploy:containers`               | Exit 0; 12 label pemeriksaan, sekitar 140.4 detik, menggunakan cache dari percobaan sebelumnya                                                                |
| Scoped Prettier dan `git diff --check` | Lulus; warning CRLF schema yang sudah ada bukan perubahan schema slice ini                                                                                    |

Label container mencakup pembangunan individual dan ringkasannya; bukan 12 test browser terpisah. Waktu container adalah run dengan cache campuran, bukan cold benchmark. Tidak ada pengukuran CPU, peak process-family memory, atau token workflow; percobaan yang gagal tidak menjadi pembanding performa yang ekuivalen.

## Bukti container nyata

Runner membangun API, admin, dan undangan dari Dockerfile final, serta image migration berbasis API. Web build memakai Webpack. Ia menjalankan PostgreSQL 18 pada tmpfs dalam project QA acak; tidak menggunakan PostgreSQL harian atau database kerja.

Yang terbukti pada final run:

- Compose native hasil parser mempertahankan definisi source Coolify kecuali extension health exclusion platform.
- Migration memakai role migrator tersendiri dan selesai sebelum API dimulai.
- Ketiga image healthcheck lulus; API memeriksa PostgreSQL nyata.
- Halaman admin dan undangan merespons; `/api/admin/auth/me` melalui proxy admin mengembalikan 401 yang diharapkan untuk sesi kosong.
- Prisma migration status dari container API sudah up to date, dijalankan melalui Node tanpa pnpm runtime.
- Role `invitation_app` adalah NOSUPERUSER/NOCREATEDB/NOCREATEROLE.
- Bootstrap compiled membuat OWNER sintetis, bootstrap ulang ditolak, dan login melalui proxy admin berhasil.
- Cookie hasil login memiliki prefix `__Host-admin_session`, Secure, HttpOnly, dan tidak mempunyai Domain. Probe memakai HTTP loopback antar test client/container dengan Origin sintetis HTTPS yang diharapkan; **ini tidak membuktikan TLS atau browser cookie behavior pada domain Coolify**.
- Stack QA final dihapus setelah identitas label project diperiksa. Tidak ada container project `invitation-container-smoke-*` tersisa pada penutupan.

## Masalah yang ditemukan dan perbaikannya

1. Runtime berbasis pnpm mencoba mengunduh package manager pada pemeriksaan migration status. Startup aplikasi, migration, dan OWNER bootstrap sekarang memakai Node langsung; runtime image tidak menyiapkan atau mengunduh pnpm. Consumer `compose.local-stack.yaml` ikut diperbarui.
2. Ada host Node process yang mengembalikan Out of memory saat percobaan build paralel. Build kini berurutan, dengan heap Node build 1536 MiB. Itu bukan bukti peak memory maupun batas total memory semua proses.
3. Build undangan Turbopack tertahan pada optimized production build. Transport build QA dihentikan setelah parent chain, command/project, dan creation identity diperiksa. Docker Desktop kemudian ditemukan berstatus stopping dengan API error 500. Hubungan sebab pasti antara seluruh gejala tersebut belum dibuktikan.
4. Atas persetujuan owner, Docker Desktop dipulihkan tanpa reset atau penghapusan volume. Cleanup QA yang tertunda dilakukan hanya pada project tepat dalam receipt, lalu receipt dipertahankan sebagai resolved. Database kerja dan preview lama kembali teramati listening.
5. Webpack menemukan ekspor `DetailContent` dan `RsvpDetailContent` yang tidak sah dalam route `page.tsx`. Helper dipindah ke komponen server biasa; route hanya mengekspor entry point yang didukung. Test terkait mengikuti pemilik komponen baru dan lulus. Tidak ada bypass typecheck atau perubahan perilaku UI yang disengaja.
6. Docker dependency layer dipisahkan dari source dan pilihan APP; script runtime dicopy setelah application build. Foto original di `gambar-edit`, konfigurasi privat, backup, dan output lokal tidak ikut image.

## Integritas penutupan

Fingerprint seluruh 17 tabel database harian dan hash `.env.daily` sama dengan baseline data yang direkam sebelum smoke test pada sesi yang sama. Seluruh 72 aset/foto yang dipantau sama dengan baseline source slice CI/CD. Schema Prisma, OpenAPI, generated client, dan Turbo config tidak berubah pada slice ini.

HEAD tetap `6bb089bf89ca36752c87a20d6625519101f3b42e`; staging tetap kosong. Perubahan sebelumnya di working tree dipertahankan. Stack daily `invitation_daily` ready dengan API dan kedua web worker running. Port database kerja 5433 dan preview 3000/4010 kembali listening setelah pemulihan Docker. Tidak ada migration yang dijalankan pada database kerja 5433 oleh verifikasi ini.

Hasil privat: `.local-daily/container-smoke.json`, `.local-daily/coolify-container-complete-20261016.log`, dan `.local-daily/coolify-closing-20261016.json`. Log kegagalan awal tetap terpisah untuk diagnosis. Tidak ada token produksi, password nyata, atau link tamu yang disalin ke laporan.

## Yang belum dibuktikan

- Eksekusi CI pada GitHub untuk commit yang berisi perubahan ini; belum dieksekusi ketika verifikasi lokal dicatat.
- Permission promosi GitHub, branch/environment protection, pengiriman webhook GitHub App, clone SHA yang dipromosikan, serta normalisasi Compose pada versi Coolify server yang terpasang.
- Domain, certificate/HTTPS, log proxy/CDN/drain, konektivitas database privat server, kebijakan backup/retensi/restore produksi, kapasitas server, dan operasi saat deployment gagal.
- Kamera Android/iPhone fisik dan perjalanan lengkap tamu/staff melalui domain deployment. Bukti browser nyata dan kamera sintetis dari smoke test lokal sebelumnya tetap tercatat terpisah di `SMOKE-TEST.md`.
- Zero downtime, deployment atomik, serta rollback schema otomatis tidak disediakan.

Ikuti [runbook aktivasi](COOLIFY-DEPLOYMENT.md) setelah perubahan direview dan masuk ke default branch. Promosi dinonaktifkan secara default sampai GitHub Environment disiapkan. Pada akhir slice verifikasi lokal ini belum dibuat resource/cabang rilis atau deployment; publikasi checkpoint Git dilakukan sebagai langkah terpisah atas instruksi owner.
