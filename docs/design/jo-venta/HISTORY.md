# Jo & Venta — Paket A / Rancangan 01

> Keputusan terbaru owner, 16 Oktober 2026: kembalikan hasil pertama setelah gambar-edit masuk (prototype pertama), bukan tampilan sebelum ada foto original dan bukan pemulihan parsial globals.css. Artefak awal ditemukan pada riwayat task sebelum revisi layout Figma. Runtime kini memakai first-photo-theme.css: foto profil besar di atas teks, nama panggilan Parisienne 48px, nama lengkap Spectral 24px, galeri Pic1/Pic2/Pic3/Cover dan panel foto kiri pada desktop >=1024px dengan tinggi >=650px. Mobile satu kolom. Foto original, keluarga terkonfirmasi dan kontrak RSVP/pass/message tetap dipertahankan.

> Revisi owner 16 Oktober 2026: posisi foto dan tipografi runtime dikembalikan ke undangan aplikasi sebelum redesign terakhir. Aturan dasar globals.css kembali dipakai untuk profil (nama 2.25rem, dengan 1.75rem pada layar dua kolom 361–479px agar nama tidak terbelah di tengah kata; gap 20px; satu kolom pada <=360px) dan galeri (gap 14px, bingkai 18px). Cover memakai komposisi sempit/terpusat seperti sebelumnya, dengan foto original owner dan teks semantik terpisah. Keluarga, foto original, motion/reduced-motion, lightbox dan kontrak form tetap dipertahankan. Prototype Figma sebelumnya adalah artefak historis, bukan tampilan runtime terbaru.

15 Oktober 2026. V01–V04: isi, manifest enam foto, prototype dan storyboard tersedia. V05: arah layout dikunci melalui jawaban owner, **“layout nya menggunakan design di figma”**. Implementasi berikutnya memakai komposisi Figma dan satu kolom di tengah pada desktop; usulan panel foto kiri dibatalkan sebelum integrasi aplikasi.

## Membuka prototype

Dari root project:

```powershell
rtk proxy node docs/design/jo-venta/serve.mjs
```

- Pembukaan: <http://127.0.0.1:4317/>
- Cover foto: <http://127.0.0.1:4317/?view=opened>
- Isi panjang: <http://127.0.0.1:4317/?view=content>
- Verifikasi: `rtk proxy node docs/design/jo-venta/verify.mjs`

Prototype hanya mendemonstrasikan desain dan interaksi lokal. Tidak menjalankan API/database; nama tamu sintetis, RSVP/pesan tidak dikirim, area pass tidak berisi QR yang dapat dipindai. Toolbar review dan catatan sampel tidak masuk halaman tamu. Server hanya bind loopback, menolak metode selain GET/HEAD, dan memakai CSP `connect-src 'none'; form-action 'none'`.

Font memakai alias ke hasil build Next lokal yang sudah tersedia. Bila cache build belum ada, browser memakai fallback sistem; jalankan build aplikasi untuk melihat font project yang persis. Media foto dan dekorasi tetap lokal.

## Keputusan komposisi yang dipakai

- Amplop navy dan wax seal existing; tidak menggambar ulang ornamen vendor.
- Cover foto bersih `gambar-edit/Cover.JPG`, nama berupa teks yang terpisah dari foto.
- Desktop satu kolom terpusat, maksimum 480 px; mobile mengisi layar. Tidak ada panel kiri atau dua scroll container.
- Sapaan rata kiri, bride foto kiri/teks kanan, groom foto kanan/teks kiri, tanggal dan dua contoh acara mengikuti Figma.
- Cream/navy, Spectral, Luxurious Script, serta dekorasi Figma existing dipertahankan. Perubahan ukuran/spacing mengutamakan responsive dan target sentuh yang layak.
- RSVP memakai semantik household/named invitees milik aplikasi, bukan menyalin checkbox spouse/children pada gambar Figma menjadi aturan domain.
- Galeri empat posisi memakai tiga foto Pic dan Cover yang sengaja diulang. Tidak mengasumsikan foto galeri keempat yang belum diberikan.
- Musik, video, story, gift dan navigation tambahan tidak otomatis masuk scope. Anchor navigasi pada prototype adalah alat review; halaman asli mengikuti layout Figma tanpa toolbar review.

## Isi dan materi

[Matriks isi](CONTENT-MATRIX.md) membedakan data API, copy Figma, keputusan yang sudah resolved dan materi yang belum final. Tenggat sudah resolved: **25 Desember 2026, 23.59.59 WIB**, tetap berasal dari `rsvpDeadlineAt` di runtime. Tidak meminta owner memutuskan ulang nilai tersebut.

[Manifest aset](asset-manifest.json) mencatat source path, hash, EXIF orientation, ukuran, turunan, slot, focal point kandidat dan transform. Enam original dari `gambar-edit` berjumlah 74,410,456 byte; tujuh turunan termasuk thumbnail berjumlah 2,039,740 byte (sekitar 2.04 MB). Resize/orientation/WebP bukan retouch atau perubahan wajah/warna. File asli dan hero PNG approved existing tetap utuh.

Regenerasi media prototype:

```powershell
rtk proxy node docs/design/jo-venta/prepare-media.mjs
```

## Storyboard V04

| State / aksi                  | Hasil                                                       | Timing usulan          | Fokus dan batas                                                                                |
| ----------------------------- | ----------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------- |
| Closed, klik/Enter/Space      | Front envelope bergeser dan memudar, lalu cover foto tampil | 650 ms                 | Tombol transient disabled, aktivasi ganda diabaikan; fokus ke View invitation setelah selesai. |
| Reduced motion, Open          | Cover foto langsung tampil                                  | Tanpa travel/delay     | Fokus sama; tidak menunggu timer animasi.                                                      |
| Opened, View invitation       | Isi panjang tampil dari awal                                | Fade pendek 400–550 ms | Fokus ke content landmark; tidak meminta ulang invitation dari API.                            |
| Section masuk viewport        | Reveal satu kali dengan opacity + perpindahan ≤12–14 px     | 450 ms                 | Base content tetap terlihat; form/error/pass tidak diberi reveal yang mengganggu fokus.        |
| RSVP submit di prototype      | Validasi atau dialog simulasi                               | Langsung               | Tidak ada network write; runtime tetap memakai state machine existing.                         |
| Accepted / declined           | Accepted menunjukkan area pass review; declined tanpa pass  | Langsung               | QR runtime hanya dari backend; placeholder ini hanya ada pada prototype.                       |
| Conflict / uncertain / cutoff | Notice demonstrasi dengan recovery yang relevan             | Langsung               | Runtime tidak boleh otomatis replay submit.                                                    |
| Galeri                        | Native dialog, arrows, Escape, focus return                 | Tidak menunda akses    | Isi dialog tidak dianimasikan saat dibaca.                                                     |
| Message                       | Error kosong atau konfirmasi simulasi                       | Langsung               | Tidak menyimpan pesan atau menampilkan pesan tamu lain.                                        |

Nilai timing adalah rancangan original, bukan hasil ekstraksi animasi Katsudoto. Detail runtime dapat disesuaikan melalui hasil QA dengan preferensi reduced motion tetap dihormati.

## Verifikasi dan status

[Hasil browser QA](review/verification.json) dan screenshot pada `review/` merupakan bukti prototype; bukan hasil pengujian API/DB atau runtime undangan. Script memeriksa opening keyboard, responsif 320–1440 px, layout Figma, validasi/konfirmasi, gallery focus, reduced motion, observer unavailable, media dan tidak adanya request pihak ketiga/write.

Nama/gelar empat orang tua dikonfirmasi owner pada 16 Oktober 2026 dan sudah diterapkan persis Figma pada aplikasi. Wording footer dan materi parkir/rundown tetap merupakan final-content gate sebelum publikasi. Lihat [ledger implementasi runtime](IMPLEMENTATION.md). Foto original telah tersedia; kekurangan foto resolusi tinggi tidak lagi menjadi blocker untuk slot yang dipetakan.
