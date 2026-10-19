# Implementasi template Figma dan foto asli

> Acuan final: Figma untuk tampilan, REA untuk animasi/interaksi. Lihat [FIGMA-FIDELITY.md](FIGMA-FIDELITY.md) untuk status runtime terbaru. Catatan implementasi dan rollback di bawah adalah riwayat.

Pengerjaan 15–16 Oktober 2026, Asia/Jakarta. Status: **implementasi lokal tersedia; final copy dan QA perangkat nyata masih pending**. Arah owner: foto besar/transisi halus, lalu layout mengikuti Figma. Desktop split tidak diterapkan.

## Verifikasi pemulihan hasil foto pertama

Runtime terbaru: 231 frontend unit tests, lint, optimized build dan 17 browser tests lulus. Uji mencakup panel desktop, portrait di atas copy pada 320–1440px, ukuran font, 200% text reflow, full-photo gallery, keyboard, reduced motion dan fallback hero. Screenshot runtime-layout-1440.png menunjukkan layout dua kolom aktual. Pengujian root/API/DB sebelumnya tetap bukti historis, bukan pengujian ulang pada slice visual ini.

## Riwayat verifikasi pemulihan CSS sebelumnya

Revisi terbaru: lint, typecheck, build dan 231 unit tests frontend lulus. Browser suite built-local: **17 lulus**, menguji layout 320–1440px, ukuran nama yang dipulihkan, one-column profile <=360px, keyboard, reduced motion, gallery focus dan fallback hero. Bukti visual runtime terbaru pada review/runtime-*.png menggantikan capture sebelum revisi. Suite development 63 lulus/1 skipped dan root 828 lulus di bagian historis adalah hasil sebelum revisi CSS ini, tidak diklaim sebagai pengujian ulang backend. Copy keluarga dan foto tidak diubah.

## Implementasi awal sebelum revisi foto dan font

- Amplop navy memakai artwork existing. Front layer bergeser/memudar 650 ms; aktivasi ganda dibatasi, timer dibersihkan, fokus berpindah ke tombol tahap berikutnya. Reduced motion melewati delay, termasuk ketika preferensi berubah saat transisi.
- Opened cover memakai foto bersih `Cover.JPG` melalui turunan WebP. Judul terpisah dari foto; CTA terbaca. Bila image gagal, artwork hero PNG lama yang tidak diubah menjadi fallback dengan satu judul semantik, sehingga tidak ada teks overlay ganda.
- Undangan tetap satu kolom, maksimal 480 px, terpusat di desktop. Sapaan rata kiri, bride foto kiri, groom foto kanan, tanggal/acara, dress code, RSVP, galeri, quote, pesan dan closing mengikuti susunan Figma. Data acara tetap datang dari API.
- Enam foto owner dipetakan secara visual. Galeri memakai Pic2, Pic3, Pic1, kemudian Cover yang sengaja diulang. Thumbnail portrait Pic2 dibuat dari original agar tidak kabur akibat memperbesar gambar landscape yang pendek; lightbox tetap memakai foto landscape utuh.
- Styling tema ada di `apps/invitation-web/components/invitation/invitation-theme.css`; source existing dipertahankan dan dilapisi perubahan terfokus. Tidak menambah library motion atau font baru.
- Section reveal merupakan enhancement satu kali. Konten dasar tetap visible, observer unavailable tidak menghilangkan isi, dan form/error/pass tidak menjadi target animasi reveal.
- RSVP, pass QR, pesan, Maps/ICS dan published venue memakai kontrak/state machine existing. Perubahan form/konfirmasi terbatas pada presentasi. Tidak menambahkan companion entitlement, QR general, offline pass, template builder atau upload foto admin.

## Ledger task implementasi awal

| Task | Status lokal                         | Bukti / catatan                                                                                                                                                    |
| ---- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| V01  | Sumber isi direkonsiliasi            | CONTENT-MATRIX; tenggat 2026 sudah resolved; nama/gelar orang tua dikonfirmasi owner 16 Oktober 2026, persis Figma.                                                |
| V02  | Selesai untuk slot yang dipetakan    | 6 original, 7 turunan termasuk thumbnail; manifest/hash/orientasi tersedia.                                                                                        |
| V03  | Prototype dibuat dan direvisi        | Rancangan 01 memakai Figma composition; screenshot tersedia.                                                                                                       |
| V04  | Diterapkan                           | Storyboard, opening keyboard, anti-double-activation dan reduced motion.                                                                                           |
| V05  | Layout diputuskan owner              | Mengikuti Figma, satu kolom centered desktop. Final accuracy copy bukan otomatis ikut resolved.                                                                    |
| V06  | Baseline dicatat                     | Build lokal sebelum perubahan: LCP 180 ms, CLS 0, script transfer 148,266 byte; ini bukan baseline jaringan/perangkat produksi.                                    |
| V07  | Diterapkan                           | Tema terfokus, warna/spacing/type scale; font existing.                                                                                                            |
| V08  | Diterapkan sesuai revisi             | 320/360/390/412/768/1024/1440 px; tanpa desktop split.                                                                                                             |
| V09  | Diterapkan dan diuji                 | 650 ms, fokus, repeated activation, preference change, cleanup.                                                                                                    |
| V10  | Diterapkan dan diuji                 | Foto bersih + teks; fallback image-failure tetap mempertahankan artwork lama.                                                                                      |
| V11  | Layout profil diterapkan             | Nama existing dan empat nama/gelar orang tua persis Figma diterapkan setelah konfirmasi owner; label Daughter of/Son of dan pasangan orang tua tampil pada profil. |
| V12  | Presentasi diterapkan; kontrak tetap | Acara eligible, WIB, calendar, countdown dan publikasi venue lulus regresi. Materi venue final tetap pending.                                                      |
| V13  | Tidak ditambahkan sesuai scope Figma | Navigasi section tambahan hanya alat review prototype; bukan task produksi yang tertinggal.                                                                        |
| V14  | Skin diterapkan; fungsi diverifikasi | Accept/decline/update/deadline/conflict/uncertain masih memakai state machine existing.                                                                            |
| V15  | Presentasi diterapkan                | Kartu peach, QR pada putih dengan quiet zone existing, message feedback. Tidak mengubah lifecycle pass.                                                            |
| V16  | Diterapkan dan diuji                 | Galeri original, uncropped lightbox, keyboard/focus; intentional Cover reuse.                                                                                      |
| V17  | Diterapkan                           | Reveal satu kali, reduced motion, fallback observer.                                                                                                               |
| V18  | Diterapkan                           | Next responsive images, lazy/full image, thumbnail sesuai slot, nama file dengan digest untuk invalidasi cache, tanpa query URL.                                   |
| V19  | QA lokal lulus                       | Keyboard, focus, reduced motion, 320 px dan 200% text-size reflow; screen reader/perangkat nyata belum diuji.                                                      |
| V20  | Gate lokal lulus                     | Root lint/typecheck/build, root 828 unit/integration, frontend 231 setelah perubahan media, public browser suites.                                                 |
| V21  | QA emulasi tersedia                  | Chromium, screenshot 390/412/1440 px, geometri/nonempty media; tidak mengklaim Safari/iOS/Android fisik atau field Web Vitals.                                     |
| V22  | Runbook dan snapshot tersedia        | Penggantian foto, hash source/legacy art, ledger, artefak review.                                                                                                  |

P2 musik, story/video/gift dan uploader foto desain tidak dikerjakan karena bukan bagian scope yang dipilih. Deployment/domain dan aktivasi migration development tetap pekerjaan operasi terpisah.

## Verifikasi implementasi awal (historis)

- `pnpm lint`, `pnpm typecheck`, `pnpm build`: lulus. Gate yang menghasilkan Prisma dijalankan berurutan. Warning fallback metric TikTok Sans sudah ada pada baseline; tidak menghalangi build.
- Root `pnpm test` melalui runner QA terisolasi: **828** lulus (API 284, admin 306, invitation 231, api-client 7). PostgreSQL menggunakan cluster QA loopback port 55432 dan database `invitation_qa_20261015`; development/production DB tidak dipakai. Tidak ada migration yang diterapkan pada pengerjaan template ini. Cluster QA dihentikan setelah pengujian.
- Public development suite: **63 lulus, 1 skipped**. Skip adalah test optimized performance yang memang hanya berjalan pada built-local. Suite mencakup RSVP, pass, message, recovery, eligibility dan venue.
- Final optimized browser suite: **17 lulus**, termasuk `review/runtime-visual-verification.json`; enam pemeriksaan desain ditambah suite existing menguji opening, image fallback, centered layout, 200% text-size reflow, gallery full image dan media geometry.
- Prototype isolated: **23** pemeriksaan lulus, tidak ada request non-GET/pihak ketiga atau browser exception pada pengamatan.
- Ketujuh URL fotografi dengan nama digest menghasilkan HTTP 200 dari Next image optimizer; capture runtime memastikan semua image complete/nonempty dan cover tidak memakai fallback pada perjalanan normal.
- Semua 31 aset aplikasi existing dan keenam original owner dipertahankan byte-identik. Foto turunan adalah file baru. Screenshot runtime hanya memakai household sintetis tanpa saved RSVP/active pass; tidak menangkap QR atau credential nyata.

Test screenshot penuh meminta offscreen lazy images secara eksplisit untuk capture. Setiap image juga discroll ke viewport lalu diperiksa complete/nonempty sebelum capture; perubahan loading saja dapat meninggalkan responsive candidate offscreen belum diminta oleh Chromium. Pemeriksaan text clipping mengecualikan legend `visually-hidden` yang memang dimaksudkan untuk screen reader. Ini perbaikan harness, bukan pelemahan gate konten terlihat.

`review/runtime-visual-verification.json` mencatat hero readiness dan geometri image pada 390/412/1440 px. Hero readiness adalah durasi perjalanan test driver, bukan LCP setelah interaksi, bukan INP dan bukan jaminan layanan produksi. Final built-local mencatat LCP 60 ms, CLS 0, long tasks 0 dan script transfer 149,082 byte. Profil CPU/network tidak dibatasi untuk run localhost ini; warm cache dapat mengubah hasil. Angka ini tidak membuktikan peningkatan performa atau kondisi jaringan/perangkat produksi. Ambang script transfer existing <200 KB tetap dipakai.

## Preview lokal dengan data sintetis

Preview saat penutupan tersedia pada `http://127.0.0.1:3000/i/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`. Semua nama tamu/acara pada demo ini adalah fixture, bukan data undangan live. Preview desain terisolasi tetap di `http://127.0.0.1:4317/?view=content`.

Untuk menjalankan ulang demo aplikasi, build dahulu, lalu gunakan dua terminal dari root project (tanpa mengubah file `.env`):

```powershell
# Terminal 1: mock API, bukan database atau API live
rtk proxy pnpm --filter invitation-web exec tsx e2e/mock-public-invitation-api.ts
```

```powershell
# Terminal 2: override hanya untuk proses terminal ini
$env:INVITATION_API_BASE_URL = "http://127.0.0.1:4010"
rtk proxy pnpm --filter invitation-web exec next start --hostname 127.0.0.1 --port 3000
```

Hentikan proses demo sebelum menyalakan server development pada port yang sama. Override demo tidak mengubah konfigurasi API aplikasi untuk penggunaan normal.

## Mengganti foto nanti

1. Masukkan foto original ke `gambar-edit`, pertahankan file original. JPG/JPEG, PNG atau WebP dapat diproses; jangan mengganti ekstensi PNG menjadi JPG. Jika nama/format berbeda, sesuaikan `source` di `prepare-media.mjs` terhadap nama file sebenarnya.
2. Periksa pemetaan visual, focal point dan slot. Target source sisi panjang sekitar ≥2000 px bila tersedia; jangan memperbesar thumbnail dan menganggapnya foto original.
3. Jalankan dari root:

```powershell
rtk proxy node docs/design/jo-venta/prepare-media.mjs
rtk proxy node ops/prepare-wedding-media.mjs
rtk proxy pnpm --filter invitation-web build
```

4. Generator pertama menulis media review/manifest, menormalisasi orientasi EXIF dan membuat thumbnail Pic2 dari original. Installer memvalidasi seluruh hash/pemetaan sebelum menulis tujuh file bernama digest pada `public/assets/photography` serta `wedding-media.generated.ts`.
5. Nama file foto memiliki digest publik yang berubah ketika byte foto berubah (contoh `venta-<digest>.webp`), tanpa query. Query digest ditolak oleh image optimizer pada konfigurasi existing; batas keamanan tidak dilonggarkan. Dengan demikian Next image optimizer/browser tidak memakai cache versi foto lama pada URL yang sama setelah rebuild. Digest bukan credential.
6. Installer tidak menghapus foto versi lama otomatis. Jika mengganti foto lagi, hapus hanya file versi lama yang sudah diverifikasi tidak dipakai deployment aktif; jangan menghapus seluruh folder atau aset approved.
7. Review crop/fokus di 390/412 px dan desktop; buka lightbox untuk memastikan foto utuh benar. Jika focal point berubah, selaraskan konfigurasi `src/presentation/wedding-media.ts`, manifest dan preview, lalu ulangi QA yang relevan.

Uploader `/event-content` existing adalah untuk parkir/rundown. Foto desain menggunakan pipeline lokal ini; tidak ada klaim bahwa uploader desain lengkap sudah dibuat. Materi parkir/rundown final tetap diupload/disimpan draft/preview/publish melalui workflow admin existing.

## Yang belum final

- Nama/gelar empat orang tua sudah dikonfirmasi owner pada 16 Oktober 2026 dan diterapkan persis Figma. Ini sudah resolved, bukan pertanyaan terbuka lagi.
- Wording footer existing belum diubah; klaim no-AI adalah final-copy review owner, bukan fakta baru yang disimpulkan dari implementasi.
- Materi parkir/rundown final dan final venue-copy accuracy, termasuk keterangan layanan makanan.
- Safari/iOS, Android fisik, screen reader dan field metrics setelah hosting tersedia.

Tidak ada commit/staging/deployment. Branch tetap `fix/checkin-manual-status-reconciliation`, HEAD `6bb089bf89ca36752c87a20d6625519101f3b42e`; pekerjaan sebelumnya pada worktree yang sudah dirty dipertahankan.
