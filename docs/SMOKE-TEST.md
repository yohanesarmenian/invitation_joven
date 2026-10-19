# Smoke test otomatis undangan

Terakhir dijalankan: 16 Oktober 2026. Chromium, API nyata, dan PostgreSQL 18 lokal pada database QA terpisah. Akun dan tamu sintetis; tidak membutuhkan akun OWNER pada database harian.

## Menjalankan ulang

Dari `D:\Projects\invitation_joven`, dengan Docker Desktop aktif:

```powershell
pnpm local:down
pnpm local:build
pnpm local:verify
pnpm local:verify:gaps
pnpm local:up
```

Jalankan berurutan dan lanjutkan hanya jika command sebelumnya berhasil. `local:verify` adalah runner otomatis alur utama; `local:verify:gaps` menambahkan impor CSV/XLSX, onboarding staff, persistensi materi, serta simulasi kegagalan. Build memastikan fixture memakai API compiled terbaru. Jangan menjalankan beberapa verifier bersamaan.

Runner menolak mengambil alih server yang masih aktif atau status ownership yang belum jelas. Setiap run mengalokasikan database QA acak, menerapkan migration ke QA, membuat data sintetis, menjalankan pemeriksaan, dan membersihkan database tersebut. Data QA tidak disalin ke database harian. Jika gagal, periksa status dan log privat sebelum melanjutkan; identitas cleanup yang belum selesai dipertahankan di `.local-daily/verification-cleanup-pending.json` bila jalur tersebut terpicu.

## Hasil eksekusi

| Pemeriksaan                                             | Hasil                                                                        |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm local:build`                                      | Lulus: API, invitation-web, admin-web                                        |
| `pnpm local:verify`, setelah penambahan kasus identitas | Lulus: 13 kasus browser, 17 kelompok pemeriksaan; 117.940 detik              |
| `pnpm local:verify:gaps`                                | Lulus: 2 kasus browser impor CSV/XLSX, 20 kelompok pemeriksaan; 83.030 detik |
| `pnpm --filter admin-web typecheck`                     | Lulus                                                                        |
| ESLint pada file browser yang diubah                    | Lulus                                                                        |
| `pnpm local:lint`                                       | Lulus                                                                        |

Kelompok pemeriksaan mencakup kasus browser dan pemeriksaan runtime lainnya; jumlahnya tidak dijumlahkan sebagai jumlah test case. Run awal sebelum kasus identitas ditambahkan juga lulus: 12 kasus browser, 17 kelompok, 115.378 detik.

| Alur                  | Bukti yang diperiksa                                                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pembuatan manual      | OWNER membuat undangan melalui UI; anggota, kuota, pilihan acara, dan link tersimpan                                                                       |
| Identitas undangan    | Dua household dengan nama sama memiliki credential link berbeda dan menampilkan sapaan masing-masing                                                       |
| RSVP dan QR           | Sebelum RSVP hadir belum ada pass; setelah RSVP backend menerbitkan QR berbeda untuk kedua household; RSVP kedua tidak mengubah RSVP pertama               |
| Pembacaan ulang       | Link pertama tetap mengembalikan QR aktif miliknya setelah undangan kedua mengirim RSVP                                                                    |
| Staff                 | Masing-masing QR tervalidasi ke ID household yang tepat; validate tidak mencatat kedatangan                                                                |
| Scanner               | Decoder ZXing membaca QR dari halaman tamu melalui stream kamera sintetis                                                                                  |
| Konfirmasi kedatangan | Operator tersimpan, duplikasi ditolak, dua operator tidak dapat menggandakan check-in household/acara yang sama                                            |
| Respons hilang        | Rekonsiliasi status membaca hasil server tanpa mengirim konfirmasi kedua otomatis                                                                          |
| CSV/XLSX              | Preview, pemilihan baris, konfirmasi impor, nama/sapaan, anggota, kuota, deadline WIB, dan acara tersimpan; pemulihan hasil commit tidak menggandakan data |
| Staff baru            | Password sementara tampil sekali; staff wajib mengganti password sebelum scanner dapat dipakai                                                             |
| Laporan               | Expected RSVP dan actual check-in sesuai database; ekspor mengikuti filter                                                                                 |
| Restart dan kegagalan | RSVP, QR, pesan, check-in, operator, dan materi tetap tersimpan setelah restart; transaksi yang terputus sebelum commit tidak menjadi data parsial         |

Kasus nama sama memulai dua household sintetis melalui fixture yang menggunakan `CredentialService` produksi; sapaan disiapkan dalam database QA. Pembacaan halaman, submit RSVP, penerbitan pass, dan validasi staff memakai backend nyata. Pembuatan melalui UI dan impor CSV/XLSX diperiksa dalam kasus terpisah. Ini tidak mengklaim satu kasus tunggal yang mengimpor nama duplikat lalu menjalankan seluruh perjalanan tamu.

## Integritas dan artefak

Fingerprint seluruh 17 tabel database harian serta hash konfigurasi privat sama sebelum dan setelah pengujian. Tidak ada database `invitation_qa_daily_*` tersisa pada pemeriksaan penutupan. Seluruh 72 file aset/foto yang dipantau sama dengan baseline. HEAD dan staging tidak berubah.

Hasil mesin dan log disimpan privat dalam `.local-daily`:

- `verification.json` dan `verification-gaps.json`: hasil runner terbaru, ditimpa pada run berhasil berikutnya.
- `smoke-result-20261016.json`: ringkasan dan pembandingan integritas sesi ini.
- `smoke-core-identity-20261016.log` dan `smoke-imports-20261016.log`: log eksekusi sesi ini.

Screenshot, trace, dan video browser sensitif dinonaktifkan. Token link, QR, password, dan konfigurasi privat tidak disalin ke laporan ini.

Perubahan sesi hanya menambahkan kasus identitas di `apps/admin-web/e2e-real/invitation-journey.e2e.ts`, memperbarui jumlah kasus yang diwajibkan runner `ops/daily/verify.mjs`, dan membuat dokumen ini. Tidak ada perubahan fitur produksi, schema, migration source, commit, atau deployment.

## Batas verifikasi

Belum membuktikan kamera/autofocus/izin Android atau iPhone fisik, akses LAN/HTTPS, hosting produksi, pengiriman undangan, materi acara final, atau beban seluruh tamu. Hasil build juga tidak membuktikan runtime container produksi. Pengujian menggunakan konten sintetis dan profil development lokal.
