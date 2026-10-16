# Task redesign undangan Jo & Venta

> Acuan final owner, 16 Oktober 2026: tampilan mengikuti Figma persis; REA hanya menjadi acuan animasi/interaksi. Runtime memakai figma-invitation-theme.css dan ekspor Figma terbaru. Lihat [pemetaan dan batas fidelity](design/jo-venta/FIGMA-FIDELITY.md). Keputusan prototype/susunan foto sebelumnya di bawah merupakan riwayat dan telah superseded.

Tanggal: 15 Oktober 2026. Status: **implementasi lokal V01–V22 tersedia, termasuk QA emulasi dan runbook; gate perangkat nyata/final venue/deployment tetap pending**. Dasar: [riset REA + Figma + source project](TEMPLATE-DESIGN-RESEARCH.md), dengan preferensi owner **foto besar dan transisi halus**.

Pembaruan pelaksanaan: [Paket A / Rancangan 01](design/jo-venta/README.md). V01 matriks isi tersedia dan deadline telah direkonsiliasi terhadap keputusan existing; V02 enam foto original telah dipetakan dan dibuatkan turunan; V03 prototype direvisi mengikuti layout Figma; V04 storyboard tersedia; V05 owner memilih layout Figma. Empat nama/gelar orang tua telah dikonfirmasi owner dan diterapkan pada 16 Oktober 2026. Detail status setiap task, scope yang berubah, hasil pengujian dan batas QA ada pada [ledger implementasi](design/jo-venta/IMPLEMENTATION.md). Final venue/footer accuracy tetap pending.

Delta scope dari keputusan owner: V08 menggunakan satu kolom centered yang sudah menjadi arah Figma, bukan desktop split; V13 tidak menambah navigation produksi di luar Figma; V10 memakai clean Cover.JPG yang kini tersedia. Angka estimasi awal di bawah bersifat historis sebelum perubahan scope ini.

Hasil akhir: satu undangan original dengan identitas navy–cream/hydrangea dan isi Figma, fotografi dominan, pengalaman mobile/desktop yang rapi, serta fungsi existing tetap benar. P0 berarti prasyarat, P1 bagian utama, P2 opsional. Estimasi adalah jam kerja aktif, tidak termasuk menunggu foto, review owner, atau pengujian perangkat yang belum tersedia.

Total estimasi 22 task utama: **32.5–62 jam aktif**, sebelum backlog P2. Ini rentang perencanaan, bukan janji waktu selesai; kualitas/material foto dan hasil QA dapat mengubah estimasi.

## Urutan kerja dan keluaran per paket

| Paket                    | Task    | Keluaran yang bisa direview                                                                      |
| ------------------------ | ------- | ------------------------------------------------------------------------------------------------ |
| A — isi dan desain       | V01–V05 | Matriks isi, manifest foto, komposisi original mobile/desktop, storyboard dan keputusan terbuka. |
| B — fondasi visual       | V06–V10 | Baseline aman, token, layout responsive, opening dan hero.                                       |
| C — seluruh isi undangan | V11–V16 | Profil, acara, navigasi, RSVP, QR/pesan dan galeri konsisten.                                    |
| D — motion dan mutu      | V17–V19 | Gerak halus, aset efisien, aksesibilitas dan fallback.                                           |
| E — penutupan            | V20–V22 | Regresi fungsi, QA visual/performa dan panduan mengganti materi.                                 |

Jalur utama: V01/V02 → V03/V04 → V05 → V06–V10 → V11–V16 → V17–V19 → V20–V22. Task aset dan copy dapat berjalan berdampingan dalam paket A. Implementasi dikerjakan satu slice yang dapat direview pada satu waktu.

Jika foto asli belum tersedia, V02 membuat daftar slot dan fallback; V03–V09 serta section nonfoto tetap bisa maju. V10/V11/V16 boleh memakai placeholder lokal yang jelas selama pengembangan, tetapi **final visual QA foto besar** menunggu source yang layak. Jangan mengubah aset hero approved secara diam-diam atau menganggap ekspor halaman Figma sebagai foto bersih.

## Paket A — isi, aset, komposisi

### V01 — Rekonsiliasi isi Figma dan authority aplikasi

**P0 · 1–2 jam · Dependensi: tidak ada.**

- Input: node Figma `17:18`, `81:42`, `82:113`; `PRD.md`, `UI-UX-SPEC.md`; source long page dan model RSVP.
- Kerja: catat semua copy per section; bedakan editorial, data API, dan materi opsional. Rekonsiliasi nama, orang tua/gelar, venue, 08.00/12.00 WIB, tanggal acara, dress code, ayat/quote dan footer. Tandai konflik RSVP Desember 2027 terhadap Januari 2027. Jangan menyalin jumlah tamu/checkbox Figma sebagai kontrak.
- Output: tabel isi dengan status confirmed / perlu keputusan / API-owned. Update source-of-truth docs hanya untuk keputusan yang benar-benar disepakati.
- Selesai bila: setiap section mempunyai sumber isi; nama orang tua belum final tetap ditandai; deadline menggunakan API; tidak ada cerita, alamat, waktu atau companion entitlement yang dibuat-buat.

### V02 — Manifest foto dan audit kelayakan aset

**P0 · 1–2 jam · Dependensi: tidak ada; finalisasi memerlukan file owner.**

- Input: aset aktif dan foto original milik owner, bila tersedia. Periksa secara visual, bukan mencocokkan nama file saja.
- Kerja: petakan hero portrait, foto desktop, bride/groom, empat gallery, serta envelope/decorative yang dipertahankan. Record source path, dimensi, hash, target slot, focal point, alt/tujuan dekoratif dan provenance. Pisahkan original dari derivative.
- Output: manifest dengan fallback per slot dan daftar file yang masih dibutuhkan. Format foto: JPG/JPEG, PNG atau WebP; target original sisi panjang ≥2000 px, lalu buat turunan sesuai slot. Tidak mewajibkan foto landscape jika memang tidak ada; pilih crop/layout alternatif yang jujur.
- Selesai bila: semua slot punya pemetaan yang jelas; hero flattened 332×917 tidak diberi judul overlay kedua; foto kecil tidak dilabeli final untuk layar besar; tidak ada aset Katsudoto yang masuk project.

### V03 — Komposisi original mobile dan desktop

**P0 · 2–4 jam · Dependensi: V01 dan manifest sementara V02.**

- Kerja: buat rancangan yang dapat dilihat untuk mobile 390×844, mobile 412 px, dan desktop 1440×900: amplop, hero, profil, acara/parkir, RSVP, gallery dan closing. Tampilkan contoh nama panjang dan error form. Gunakan foto/placeholder milik project dan identitas Figma.
- Output: mockup original atau prototype statis lokal beserta anotasi crop, spacing, type scale dan section order. Menulis ke file Figma tidak termasuk otomatis; gunakan artifact lokal bila belum ada permintaan menulis Figma.
- Selesai bila: foto menjadi fokus, form tetap terbaca, teks bukan bagian bitmap, desktop punya solusi yang masuk akal, dan komposisinya tidak menyalin template referensi.

### V04 — Storyboard motion, fokus dan navigasi

**P0 · 1–2 jam · Dependensi: V03.**

- Kerja: spesifikasikan closed → transition → opened → content, termasuk apakah tetap dua CTA pada flow existing. Rekomendasi awal mempertahankan flow eksplisit; penyederhanaan menjadi satu CTA harus tercatat sebagai keputusan UX. Tentukan durasi, urutan fokus, scroll awal dan kondisi reduced motion.
- Output: tabel state/action/result; timeline pembuka, hero, reveal, dialog dan feedback tombol. Tidak menggunakan durasi DOM vendor sebagai spesifikasi kita.
- Selesai bila: tidak ada double activation, elemen tersembunyi tidak menerima fokus, RSVP tidak menunggu animasi, form rerender tidak memutar ulang reveal, dan fallback terlihat bila observer/motion gagal.

### V05 — Penutupan brief desain dan keputusan owner

**P0 · 0.5–1 jam · Dependensi: V01–V04.**

- Kerja: review artifact konkret dari V03/V04; catat section order, desktop split, foto/fallback, copy yang masih menunggu, dan fitur opsional yang ditunda.
- Output: brief final serta delta terfokus pada `docs/UI-UX-SPEC.md`/PRD jika perlu. Preferensi foto besar sudah diketahui; tidak menanyakan ulang arah yang sama.
- Selesai bila: implementer tahu apa yang dibangun dan bagian mana yang masih provisional. Material yang belum ada tidak menghalangi section independen; tidak mengklaim final asset approval sebelum fotonya tersedia.

## Paket B — fondasi visual, opening, hero

### V06 — Baseline dan batas perubahan

**P0 · 1–2 jam · Dependensi: V05.**

- Scope: fixture lokal, screenshot baseline dan dokumentasi; jangan menghapus perubahan existing yang banyak di worktree.
- Kerja: record branch/HEAD/diff/staging; hash seluruh aset approved; ambil baseline sintetis untuk opening, isi, RSVP dan dialog. Ukur build lokal yang sama agar perbandingan valid.
- Selesai bila: baseline dapat direproduksi; screenshot/trace memakai data sintetis, tidak memuat bearer credential/QR nyata; tersedia rencana rollback per file/slice tanpa reset pekerjaan lain.

### V07 — Token visual satu tema

**P1 · 1–2 jam · Dependensi: V06.**

- Scope: `apps/invitation-web/app/globals.css`, `app/fonts.ts`; konfigurasi kecil di `src/presentation/` bila diperlukan.
- Kerja: tetapkan warna surface/text/accent, spacing, heading/body scale, radius, shadow, motion duration dan z-index. Reuse font yang ada; batasi script untuk display dan audit weight yang benar-benar dibutuhkan.
- Selesai bila: component memakai token konsisten, body terbaca, focus/error jelas, tidak ada font baru tanpa alasan, dan style undangan tidak merusak admin atau preview venue.

### V08 — Layout mobile dan desktop

**P1 · 2–4 jam · Dependensi: V07.**

- Scope: opening wrapper, long-page composition dan CSS; component layout baru hanya jika menyederhanakan tanggung jawab.
- Kerja: mobile satu kolom; desktop foto sticky kiri + isi kanan; tablet dan landscape pendek fallback satu kolom. Native document scroll menjadi pilihan awal, dengan `min-height: 0`/overflow yang tidak menjebak isi.
- Selesai bila: 320, 360, 390, 412, 768, 1024 dan 1440 px tidak horizontal overflow; 200% zoom tetap membaca/mengisi form; panel kiri tidak menutupi focus/dialog; tidak ada scroll container yang menjebak keyboard.

### V09 — Pembukaan amplop yang halus

**P1 · 2–4 jam · Dependensi: V04, V08.**

- Scope: `invitation-cover.tsx`, `invitation-opening-flow.tsx`, `invitation-opening-state.ts` dan style terkait.
- Kerja: animasikan hanya layer yang sesuai artwork. Jika seal/flap menyatu, jangan menjanjikan seal terpisah tanpa aset baru. Pertahankan state machine, semantik button dan focus transfer; tangani repeated click/Enter serta cleanup transisi.
- Selesai bila: mouse/Enter/Space mencapai isi; animasi tidak membuat layar kosong permanen; reduced motion langsung mencapai state yang benar; artwork existing dan judul baked-in fallback tetap utuh. Unit test hanya untuk transisi/race baru yang bermakna.

### V10 — Hero foto besar dan tipografi

**P1 · 2–4 jam · Dependensi: V02 final atau fallback yang disepakati, V08–V09.**

- Scope: cover/presentational hero, manifest media, CSS dan `next/image` sizes.
- Kerja: pisahkan nama/teks dari foto hanya ketika foto bersih tersedia. Tentukan focal point mobile/desktop, overlay contrast dan CTA jelas. Eager-load hanya media critical; jangan membuat dua versi hero tersembunyi yang keduanya mengunduh foto besar.
- Selesai bila: wajah/nama tidak terpotong pada viewport target; tidak ada teks ganda pada fallback; tinggi media stabil; hero tajam sesuai source; hydration dan rotasi layar tidak mengulang flow.

## Paket C — isi lengkap dan interaksi

### V11 — Sapaan, mempelai dan isi editorial

**P1 · 2–3 jam · Dependensi: V01, V02, V08.**

- Scope: `public-invitation-long-page.tsx` dan presentational sections yang diekstrak seperlunya.
- Kerja: typography sapaan, potret besar, nama lengkap/nickname, family copy yang telah final, ayat, quote dan closing. Gunakan escape React dan heading hierarchy.
- Selesai bila: sapaan datang dari API, nama panjang wrap, family copy tidak diasumsikan, urutan isi sesuai brief, dan dekorasi tidak menutupi teks atau menambah screen-reader noise.

### V12 — Acara, parkir/rundown dan dress code

**P1 · 1–2 jam · Dependensi: V08, V11.**

- Scope: event cards, `event-enhancements.tsx`, `venue-information.tsx`, CSS. Jika style renderer shared berubah, cek juga preview admin.
- Kerja: hierarki tanggal/jam/lokasi, Maps/ICS/parking, schedule dan swatch yang lebih rapi. Event eligible saja; parkir/rundown hanya published dan authorized.
- Selesai bila: `Asia/Jakarta`/`HH.mm WIB` tetap benar; tidak ada event/parking dummy di halaman normal; kosong/ineligible/draft tersembunyi; PDF tetap attachment sesuai kontrak; countdown tidak menampilkan acara yang telah lewat sebagai target berikutnya.

### V13 — Tautan navigasi section

**P1 · 1–2 jam · Dependensi: V08, V12.**

- Scope: komponen navigasi undangan dan anchor section.
- Kerja: Acara / RSVP / Galeri dengan nama singkat, target nyata, focus visible dan offset heading. Pilih lokasi yang tidak menutupi kontrol ponsel/keyboard.
- Selesai bila: sebelum opening tidak mengganggu cover; target yang tidak ada tidak memiliki tautan; aktivasi tidak reset form; reduced motion menggunakan scroll biasa. Tidak menambahkan route bercredential pada analytics/history custom.

### V14 — Skin RSVP dan dietary

**P1 · 2–3 jam · Dependensi: V07, V11–V12.**

- Scope: `public-rsvp-form.tsx`, `rsvp-result-notice.tsx` dan CSS; state machine/data contract existing dipertahankan.
- Kerja: tata label, event selection, named invitees, plus-one/additional children yang eligible, dietary notes, pending/errors/success dan deadline.
- Selesai bila: accepted/declined, create/update, cutoff, version conflict dan uncertain outcome tetap benar; submit tidak otomatis diulang; tidak ada companion entitlement baru; browser autofill/keyboard tidak merusak layout. Jangan mengubah form menjadi wizard hanya untuk menyerupai vendor.

### V15 — Konfirmasi RSVP, pass QR dan pesan

**P1 · 1–2 jam · Dependensi: V14.**

- Scope: `guest-checkin-pass.tsx`, `guest-message-form.tsx`, notice/dialog yang ada dan CSS.
- Kerja: gaya konfirmasi konsisten dengan tema; pass di permukaan putih berkontras tinggi; pesan success/error jelas. Konfirmasi accepted dan declined mempunyai wording yang sesuai, bukan satu kartu generik.
- Selesai bila: QR hanya dari pass backend yang sah, inactive/unavailable tidak memakai gambar placeholder; QR tidak diberi ornamen di quiet zone atau animasi saat discan; messages tidak menampilkan daftar ucapan milik tamu lain; fokus kembali dengan benar. Tidak menambahkan download pass atau offline cache tanpa task terpisah.

### V16 — Galeri fotografi dan lightbox

**P1 · 2–3 jam · Dependensi: V02, V08, V11.**

- Scope: `gallery.tsx`, manifest foto dan CSS.
- Kerja: layout original satu foto unggulan + foto pendamping, responsive aspect ratios/focal points. Reuse native dialog, previous/next, Escape dan focus return. Full-size hanya dimuat ketika diperlukan.
- Selesai bila: urutan foto jelas, keyboard/close bekerja, potret tidak gepeng, touch target layak, modal tidak di bawah sticky panel; empat foto kecil dapat menjadi placeholder tetapi final sharpness memerlukan original.

## Paket D — motion, performa, aksesibilitas

### V17 — Sistem reveal dan transisi section

**P1 · 2–4 jam · Dependensi: V09–V16.**

- Scope: style motion dan helper kecil seperti `section-reveal.tsx` bila dibutuhkan.
- Kerja: opacity/transform 12–20 px, reveal satu kali, timing 400–600 ms, dekorasi sangat terbatas. Base content visible; enhancement tidak boleh menyembunyikan konten bila observer gagal. Cleanup listener/observer. Pilih CSS/IntersectionObserver dahulu; Motion hanya bila perlu orchestration yang nyata.
- Selesai bila: form focus/error tidak meloncat; rerender RSVP tidak memutar ulang section; reduced motion menonaktifkan zoom/travel; halaman panjang tetap lancar; tidak ada GSAP/AOS/plugin vendor yang ditambahkan untuk menyalin perilaku.

### V18 — Turunan gambar, loading dan anggaran bundle

**P1 · 1–3 jam · Dependensi: V10, V16–V17.**

- Scope: media derivatives milik owner, `next/image` sizes/loading, font weights dan dependency review.
- Kerja: sediakan ukuran yang benar; catat format/byte sebelum dan sesudah; lazy-load gallery/dekorasi noncritical; cegah preload seluruh halaman. Turunan disimpan sebagai file baru, original tidak ditimpa.
- Selesai bila: ukuran unduhan sesuai slot/DPR, tidak ada image layout shift; tidak ada request asset vendor; ukuran JS diperiksa terhadap baseline existing <200 KB transfer pada fixture optimized build. Jika dependency baru melampaui gate, evaluasi implementasi atau review anggaran secara eksplisit, jangan menaikkan test threshold diam-diam.

### V19 — Audit aksesibilitas dan fallback

**P1 · 2–3 jam · Dependensi: V13–V18.**

- Kerja: keyboard seluruh journey, heading/label, errors/status, contrast di atas foto, 200% zoom, target kontrol ≥44 px, reduced motion, dialog focus containment/return, image loading failure dan native browser Back. Uji motion helper unavailable tanpa menjanjikan seluruh aplikasi bekerja tanpa JavaScript.
- Selesai bila: informasi/form tetap dapat dipakai tanpa enhancement; hidden stage tidak dapat ditab; tidak ada trap pada desktop panel/modal; hasil submit dapat dipahami screen reader; temuan penting sudah diperbaiki dan dicatat.

## Paket E — verifikasi dan serah-terima

### V20 — Regresi fungsi dan kontrak

**P1 · 2–4 jam · Dependensi: V19.**

- Scope: existing Vitest/Playwright dengan tambahan kasus hanya untuk perilaku baru atau risiko nyata.
- Kerja: run focused tests yang berubah, kemudian gate wajib repo secara berurutan bila menghasilkan Prisma: lint → typecheck → test → build. Jangan menjalankan beberapa root command pembangkit Prisma bersamaan.
- Selesai bila: public opening, RSVP accepted/declined/update/conflict/deadline/uncertain, QR availability, messages, gallery, Maps/ICS dan published venue fixtures lulus; tidak ada API/schema/generated-client delta yang tidak diperlukan. Perubahan renderer shared memerlukan pemeriksaan preview admin. Real API smoke memakai QA database terisolasi; tidak memakai development DB secara tidak sengaja.

### V21 — QA visual, perangkat dan performa perjalanan

**P1 · 2–4 jam · Dependensi: V18–V20, foto final untuk final visual sign-off.**

- Kerja: screenshot sintetis setiap section pada 320/390/412/768/1024/1440 px; portrait/landscape, nama panjang, error dan reduced motion. Uji Safari/iOS dan Android nyata bila tersedia; catat yang belum diuji. Ukur optimized build pada profil CPU/network yang dicatat, cold/warm load, buka undangan, scroll dan interaksi RSVP.
- Selesai bila: tidak ada crop/overflow/occlusion yang material; local rendering budget existing tetap lulus; hero/opening/content dicatat terpisah; respons input tidak tertahan animasi. Target field LCP≤2.5s/INP≤200ms/CLS≤0.1 adalah tujuan p75 setelah deployment, bukan klaim dari satu run localhost. Traces/screenshot credential nyata dimatikan atau hanya memakai fixture sintetis.

### V22 — Dokumentasi mengganti materi dan closing snapshot

**P1 · 1–2 jam · Dependensi: V20–V21.**

- Kerja: dokumentasikan slot/path foto, dimensi yang disarankan, focal point, crop review, cara membuat derivative/rebuild, dan fallback. Jelaskan beda foto desain statis dengan parkir/rundown yang sudah bisa diupload via admin. Update progress dan UI spec sesuai hasil final.
- Selesai bila: owner dapat mengganti foto tanpa mengubah domain/RSVP; materi kosong tidak meninggalkan tombol palsu; report akhir memuat changed files, tests, keterbatasan perangkat/material, hash aset yang tetap, branch/HEAD/staging. Tidak commit, publish atau deploy tanpa instruksi terkait.

## Backlog P2 — hanya bila memang dibutuhkan

| Task                             | Scope dan syarat                                                                                                                  | Acceptance awal                                                                                                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| O01 — Musik latar                | File berlisensi/milik owner, kontrol play/pause, lazy loading; estimasi 2–4 jam.                                                  | Playback hanya melalui gesture yang sah, rejection ditangani, mute/pause terlihat, tab/background tidak membuat playback ganda; tidak menyimpan credential.                    |
| O02 — Story/video/streaming/gift | Materi final dan keputusan section diperlukan; estimasi setelah isi diketahui.                                                    | Tidak ada cerita karangan, embed/third-party request sebelum interaksi untuk video, informasi sensitif tidak ditambah sembarang.                                               |
| O03 — Upload foto lewat admin    | Kebutuhan produk baru, bukan fitur existing event-content; perlu spec media security/storage/publish/crop dan kontrak tersendiri. | Review auth, validasi/normalisasi, draft/publish, referential delete, versi, cache dan backup sebelum implementasi. Tidak dijadikan prasyarat redesign dengan static manifest. |

## Definisi selesai keseluruhan

1. Seluruh isi yang disepakati tersedia dengan sumber yang jelas, termasuk penyelesaian konflik tahun deadline dan family copy.
2. Mobile dan desktop sesuai komposisi original yang direview; tidak ada aset/kode vendor masuk aplikasi.
3. Foto final cukup tajam atau keterbatasan fallback dinyatakan; tidak mengklaim final premium photography dengan thumbnail kecil.
4. Opening/motion halus serta reduced motion benar; RSVP, QR dan pesan tetap memenuhi kontrak keamanan/domain existing.
5. Gate dan browser QA relevan lulus dengan evidence yang tidak memuat credential nyata; unknowns yang belum selesai didokumentasikan.
6. Panduan mengganti foto/materi dan snapshot repository tersedia. Deployment, domain dan aktivasi migration development tetap jalur operasi terpisah.

Langkah pertama yang direkomendasikan: **Paket A**. Riset sudah cukup untuk membuat komposisi original yang konkret; tidak perlu mengulang inventaris seluruh fitur vendor sebelum mulai desain.
