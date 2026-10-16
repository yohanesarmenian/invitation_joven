# Riset template Jo & Venta: foto besar, transisi halus, konten Figma

Tanggal: 15 Oktober 2026, Asia/Jakarta. Status: **riset dan usulan desain; belum diimplementasikan**.

Pembaruan Paket A: owner telah menyediakan enam foto original di `gambar-edit` dan meminta **layout mengikuti Figma**, termasuk desktop satu kolom tengah. Usulan panel foto kiri dalam bagian proposal di bawah tidak dipakai. [Brief aktif dan prototype](design/jo-venta/README.md). Koreksi authority: tenggat 25 Desember 2026 sudah resolved sejak Phase 5 Slice 5B0; nilai Figma 2027 adalah referensi usang, bukan keputusan yang masih perlu diminta ulang.

Preferensi owner yang sudah jelas: foto besar dan transisi halus. Komposisi berikut adalah usulan original untuk undangan pribadi Jo & Venta, dengan isi Figma dan aturan aplikasi yang sudah ada. Dokumen ini belum menggantikan PRD, API Contract, atau UI/UX Specification. Task terperinci tersedia di [TEMPLATE-IMPLEMENTATION-TASKS.md](TEMPLATE-IMPLEMENTATION-TASKS.md).

## 1. Kesimpulan desain

Gabungan yang paling masuk akal adalah fotografi sebagai fokus utama, navy–cream sebagai identitas, tipografi serif dengan script terbatas pada nama/judul romantis, dan hydrangea Figma sebagai aksen pada pergantian bagian. Kesan premium dibangun melalui crop foto, ritme ruang, hierarki teks, dan transisi yang konsisten.

Referensi paling dekat adalah **Noir** untuk dominasi fotografi dan desktop dengan panel foto. **Eloise** berguna untuk mempelajari momen pembukaan serta pergantian foto–ornamen–teks. **Bianca** menjadi pembanding untuk pendekatan ilustratif yang lebih ramai. Ini penilaian desain analis, bukan peringkat kualitas produk atau pilihan final owner atas template tertentu.

Kita sudah memiliki fondasi fungsional RSVP, QR, galeri, acara, parkir/rundown, admin, dan check-in. Gap untuk permintaan ini terutama berada pada presentasi dan mutu aset. Tidak perlu membangun ulang backend atau membuat platform penjual template.

## 2. Metode dan batas bukti

- **Observed / O**: screenshot yang dilihat, DOM yang ditangkap, langkah browser, inventaris aset/JavaScript, atau source project yang dibaca.
- **Documented / D**: panduan publik vendor atau standar platform. Tidak sama dengan pengujian fitur dashboard terautentikasi.
- **Inference / I**: penafsiran dari bukti terbatas, misalnya alasan suatu komposisi terasa lebih fotografis.
- **Proposed / P**: keputusan desain/arsitektur dan target QA yang kita usulkan sendiri.
- **Unknown / U**: belum terbukti atau memerlukan keputusan/material owner.

REA resmi lokal digunakan melalui koneksi **MCP stdio nyata**, bukan pengganti berupa scraping DOM manual. Repository `D:\Projects\rea`, commit `fc712b3750cbe16755c4f78c1f90fdf09fbaca31`, versi 6.5.0, SDK client 2.3.1. Katalog dan preview dibuka melalui `capture_browser_scenario` dengan aksi deklaratif; Chrome 155.0.8059.40, profil terisolasi tanpa login, timezone Asia/Jakarta. Viewport mobile 390×844 dan desktop 1440×900; motion preference dinyatakan eksplisit.

Screenshot dan DOM mentah tetap merupakan bahan investigasi lokal di `D:\Projects\rea\.cache\katsudoto-visual`. Tidak dimasukkan sebagai aset desain aplikasi. [Proyeksi evidence portable](research/2026-10-15-template-evidence.json) menyimpan ID, parameter, hasil langkah, hash screenshot, struktur terpilih, keterbatasan, dan ringkasan jaringan; ini **bukan canonical Evidence bundle**. Tidak ada source vendor, foto vendor, atau template vendor yang disalin ke kode aplikasi.

Tidak ada autentikasi, submit RSVP/ucapan, unggahan ke vendor, check-in, atau penelusuran undangan acak. Semua contoh dipilih dari tautan preview katalog publik. Membuka preview dapat memicu request/counter otomatis; tidak semua request berasal dari aksi eksplisit analis.

## 3. Indeks evidence

| Alias | Target dan cakupan                                                                          | Evidence ID                                                                |
| ----- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| V1    | Katalog; kartu dan tautan preview, mobile                                                   | `ev_4e2bbfc0684cf794be588cf8091b4a861242f25330a5b9375280a126acf0c406`      |
| V2    | Bianca sebelum membuka undangan, mobile                                                     | `ev_7657f542b70806b624e1493364cc5607bcf3386cec3edbf9920cd5a5464cd8d0`      |
| V3    | Noir sebelum membuka undangan, mobile                                                       | `ev_a86ee0733e3a3074863833d48fb5b852e0a4297f121e956cc4bb5042fd98a409`      |
| V4    | Eloise sebelum membuka undangan, mobile                                                     | `ev_857a88c8f415db0d36b815d8db82bc5ab72d823ddb9f7827a91f8b34c0093651`      |
| V5    | Noir: buka, tunggu, empat PageDown, mobile                                                  | `ev_d32ff16ad57115dc6f946f8d2b9f59d5f7786333b81b23efc9281a53dc649f8b`      |
| V6    | Eloise: buka, tunggu, empat PageDown, mobile                                                | `ev_8742d73fdd8cbccbbfaf64e015d58ef063ffe7dfd5d43db42d72019228fbe8d8`      |
| V7    | Noir: skenario mobile dengan `reduced_motion: reduce`                                       | `ev_0994b4ee0c506ed505a1f804858f6d00691c3a118454c566f59350f8dc94832d`      |
| V8    | Noir desktop: keadaan awal terlihat; klik pembuka timeout                                   | `ev_a300f8f6b3ec9216bf29f23905077c5a44b13f001c61a926062fefbbedaddcd9`      |
| V9    | Noir desktop: tiga PageDown, capture akhir terfokus                                         | `ev_5f45230c27a2aa230088453d9b6e166a240c80821ab51dc12ad1de0ed73b1735`      |
| B1    | Analisis bundle Eloise dari investigasi sebelumnya pada tanggal yang sama                   | `ev_80252aee85ad6af7f92a918e2b1c3b65e54aa60accde9a10265a0bcb83e30248`      |
| F1–F5 | Figma live: closed `7:2`, opened `14:7`, long `17:18`, registered `81:42`, message `82:113` | File key `yZZNWQ8kQIymOTixjymzoC`; `get_design_context` beserta screenshot |
| L1    | Source, dimensi PNG, dan hash aset project saat riset                                       | Inventaris lokal dalam proyeksi evidence                                   |

V1, V5–V7, dan V9 complete untuk bagian yang diminta. V2–V4 memiliki request unfinished pada akhir jendela pengamatan sehingga completeness jaringan incomplete; screenshot tetap tersedia. V8 incomplete karena aksi klik gagal, sehingga langkah lanjutnya tidak dijalankan. Capture desktop lain melebihi batas respons MCP sekitar 10 MiB; hasilnya tidak digunakan untuk klaim visual. V9 mengulang pengamatan dengan screenshot akhir saja dan berhasil. Semua hasil skenario yang berhasil dikonsumsi melaporkan `cleanup: terminated-owned-process`; ini tidak mengklaim seluruh direktori profil sementara telah dihapus.

## 4. Apa yang benar-benar terlihat pada referensi

Contoh: [Noir](https://oliviamichael.katsudoto.id/629425), [Eloise](https://annajeremiah.katsudoto.id/107754), dan [Bianca](https://biancamark.katsudoto.id/736184), berasal dari [katalog Katsudoto](https://katsudoto.id/desain/). Desain dan konten demo dapat berubah.

| Area               | Observasi terikat evidence                                                                                                                                   | Interpretasi dan penerapan original                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cover foto         | O/V3: foto monokrom memenuhi layar, nama besar, sapaan tamu dan tombol pembuka.                                                                              | I: satu foto dominan membuat hierarki kuat. P: gunakan foto milik Jo & Venta dengan warna alami dan overlay navy seperlunya.                         |
| Pembukaan          | O/V5: klik membuka cover isi dengan foto berbeda, tanggal dan countdown. Screenshot awal/lambat memperlihatkan elemen countdown muncul bertahap.             | P: satu rangkaian pembukaan singkat dengan tombol semantik dan fokus yang benar. Tidak meniru layout/gerak vendor persis.                            |
| Pembukaan berlapis | O/V4–V6: Eloise menampilkan amplop/foto/bunga pada awal lalu cover berfoto dalam bingkai.                                                                    | P: pertahankan identitas amplop navy Figma; pakai layer milik project hanya bila dapat dianimasikan tanpa merusak artwork.                           |
| Profil             | O/V5: potret tinggi dengan panel nama; V6 berganti ke bagian putih dengan teks dan ornamen.                                                                  | P: profil dengan foto lebih besar dan teks pada permukaan cream yang terbaca, tanpa menyalin panel vendor.                                           |
| Galeri             | O/V5: beberapa foto ditampilkan bersebelahan; DOM mencatat slider.                                                                                           | P: galeri original dengan satu foto unggulan dan grid pendamping; pertahankan lightbox project. Slider bukan kebutuhan wajib.                        |
| Desktop            | O/V8: dua kolom sudah terlihat sebelum aksi buka; O/V9: setelah PageDown, foto/sapaan kiri tetap terlihat dan isi kanan berubah sampai profil.               | I: konsisten dengan panel identitas yang bertahan di kiri. P: desktop panel foto kiri + isi kanan; mekanisme scroll perlu dipilih dan diuji sendiri. |
| Dekorasi           | O/V2: ilustrasi meja, lampu, bunga dan tombol merah; lebih ilustratif daripada Noir.                                                                         | P: hydrangea Figma hanya pada beberapa batas section, agar foto tetap dominan.                                                                       |
| Musik/video        | O/V5: kontrol musik tetap terlihat; saat bergulir muncul player video dengan indikator playback tanpa klik video tersendiri.                                 | U: audio benar-benar terdengar, kebijakan browser lain, dan konfigurasi vendor. P: musik opsional, video ditunda sampai interaksi eksplisit.         |
| Urutan section     | O/V5–V6: DOM memiliki section cover, quote, couple, gallery, event, rundown, RSVP, story, streaming, gift, wishes dan closing; urutan berbeda antartemplate. | P: ambil hanya section yang relevan dengan isi Figma dan aplikasi. Kehadiran DOM belum membuktikan seluruh section terlihat atau valid.              |

### JavaScript, deklarasi motion, dan jaringan

O/V5–V6: DOM memuat referensi AOS, Slick, lightGallery, serta bundle template. Eloise juga memiliki tag script GSAP/ScrollTrigger/Observer/Draggable/Flip dan Swiper. Ini inventaris referensi script; tidak membuktikan setiap modul dijalankan. B1 menganalisis 18 script Eloise dalam capture sebelumnya; count ini berbeda dari jumlah request script pada skenario baru dan bukan daftar unik seluruh produk.

O/V5: deklarasi `data-aos-duration` berkisar 400–2000 ms. O/V6: deklarasi yang ditemukan berkisar 400–7000 ms. Angka tersebut adalah atribut DOM, **bukan hasil pengukuran frame, easing efektif, atau waktu penyelesaian animasi**. Sampling screenshot setelah wait 300 ms dan 3500 ms juga mengandung overhead capture; tidak dapat menentukan durasi animasi persis. Tidak ada trace frame/computed-style timeline pada riset ini.

O/V7: halaman tetap dapat dibuka dan digulir dengan preferensi reduced motion. Beberapa elemen masih muncul bertahap pada screenshot sampel. Ini tidak cukup untuk menyatakan kepatuhan atau kegagalan aksesibilitas vendor secara menyeluruh; usulan kita harus menguji pengurangan motion secara eksplisit.

O/V5: 120 request tercatat, termasuk 30 script, 28 stylesheet dan 25 image. O/V6: 170 request, termasuk 35 script, 30 stylesheet dan 75 image. Hitungan mencakup jendela navigasi sampai akhir skenario, termasuk subresource dan pihak ketiga; bukan ukuran transfer, page weight, daftar unik, atau benchmark kecepatan. Ada request failed, dan event receipt order tidak menyediakan initiator stack. Request/response body serta nilai header tidak diminta. Request POST yang tercatat tidak digunakan untuk menyimpulkan endpoint RSVP atau keberhasilan mutasi.

P: kualitas visual serupa tidak mengharuskan menyalin tumpukan plugin tersebut. Mulai dari CSS transform/opacity, state React, dan IntersectionObserver. Dokumen project mencantumkan Motion sebagai pilihan stack, tetapi dependency aktual `invitation-web/package.json` belum memuatnya. Setiap dependency baru perlu alasan konkret dan anggaran ukuran.

### Fitur konfigurasi yang hanya didokumentasikan vendor

D: vendor mendokumentasikan penggantian desain, warna dan font pada template/paket yang mendukung, beserta preview lintas perangkat. Editor terautentikasi tidak diuji. Untuk project ini, terjemahannya cukup berupa token satu tema dan konfigurasi aset milik sendiri. [Panduan Ubah Desain](https://panduan.katsudoto.id/undangan-website/smart-dashboard/ubah-desain).

D: panduan galeri menyebut upload foto dan pengurutan, sedangkan cover pembuka memiliki teks dan fallback foto. Ini tidak membuktikan bahwa project kita sudah memiliki uploader foto. Admin yang sudah dibuat menangani materi parkir/rundown, bukan seluruh media desain. [Galeri](https://panduan.katsudoto.id/undangan-website/smart-dashboard/galeri), [Cover Pembuka](https://panduan.katsudoto.id/undangan-website/smart-dashboard/cover-pembuka).

D: vendor menjelaskan tenggat RSVP dan pilihan acara serta ringkasan QR untuk check-in. Kita mempertahankan domain dan kontrol akses milik project yang sudah ada; tidak menyimpulkan detail backend vendor. [RSVP](https://panduan.katsudoto.id/undangan-website/smart-dashboard/rsvp), [E-Invitation](https://panduan.katsudoto.id/digital-guestbook/smart-dashboard/e-invitation).

## 5. Isi Figma dan pemetaan ke aplikasi

[Figma Jo & Venta](https://www.figma.com/design/yZZNWQ8kQIymOTixjymzoC/Wedding-invitation) dibaca live pada lima node di atas, bukan hanya berdasarkan dokumen lama. Screenshot adalah referensi visual, bukan instruksi menjadikan halaman satu gambar.

| Isi Figma yang diamati                    | Kondisi source saat riset                                                         | Rencana                                                                                                                          |
| ----------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Amplop navy dan wax seal                  | Dua layer envelope dipakai oleh `invitation-cover.tsx`.                           | Pertahankan identitas; rancang transisi layer yang sesuai aset.                                                                  |
| Foto cover + The Wedding of Jo & Venta    | Hero approved berupa PNG 332×917 dengan judul menyatu.                            | Fallback tetap utuh. Foto bersih diperlukan sebelum teks/latar dapat digerakkan terpisah.                                        |
| Sapaan personal                           | `greetingName ?? displayName`.                                                    | Pertahankan data API, uji nama panjang.                                                                                          |
| Nama mempelai lengkap dan nickname        | Sudah ada pada long page.                                                         | Recompose dengan foto besar dan ruang lebih lega.                                                                                |
| Nama orang tua                            | Terlihat pada Figma; source sekarang sengaja menunda family copy.                 | Konfirmasi ejaan, gelar dan izin tampil sebelum dimasukkan. Ini gap isi yang nyata.                                              |
| Sabtu 09 Januari 2027; gereja dan resepsi | Tanggal editorial statis; daftar acara, venue, alamat dan waktu datang dari API.  | Rekonsiliasi Figma dengan data event; tetap `Asia/Jakarta` dan eligibility server. Jangan hardcode dua acara agar selalu tampil. |
| Parking guide                             | Fitur publikasi materi backend sudah ada, opsional per eligible event.            | Ubah tampilan saja; materi belum final tidak boleh tampak sebagai petunjuk nyata.                                                |
| Dress code + lima swatch                  | Sudah ada, termasuk label warna.                                                  | Rapikan visual; label teks tetap tersedia.                                                                                       |
| RSVP & Dietary                            | Form project sudah memakai household/named invitees dan companion sesuai kontrak. | Ubah skin dan hierarki; grafik checkbox Figma bukan aturan jumlah tamu.                                                          |
| Tenggat Figma 25 December 2027            | Berbeda dari tahun acara; UI project memakai `rsvpDeadlineAt`.                    | Tandai konflik; backend tetap authority, koreksi dokumen visual setelah keputusan owner.                                         |
| Galeri, 1 John 4:19 dan quote             | Empat foto, lightbox dan copy sudah ada.                                          | Tata ulang galeri; pertahankan isi tanpa menambah cerita fiktif.                                                                 |
| Message Sent dan Registered               | Figma memiliki kartu peach; Registered berisi kotak putih placeholder QR.         | Selaraskan presentasi; QR nyata hanya dari pass backend yang sah.                                                                |
| Closing/credits                           | Copy termasuk klaim “100% human made, no AI.” ada di Figma dan source.            | Minta owner meninjau kebenaran wording sebelum final; tidak diubah diam-diam.                                                    |

Generator Figma menghasilkan setidaknya satu crop dengan ukuran persentase negatif yang tidak masuk akal. Itu anomali representasi kode hasil generator, bukan bukti gambar Figma rusak. Gunakan screenshot dan crop manual yang ditinjau, bukan menyalin koordinat absolut generator.

## 6. Gap aset yang menentukan mutu foto besar

Dimensi berikut dibaca dari header PNG aktual (L1), bukan diperkirakan dari nama file:

| Aset aktif                               | Resolusi sumber                    | Implikasi                                                                     |
| ---------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------- |
| `hero/opened-hero.png`                   | 332×917                            | Judul baked-in; kurang ideal untuk crop baru atau layar lebar/retina.         |
| `photos/bride.png`, `groom.png`          | 136×186; 137×186                   | Cocok sebagai placeholder layout, bukan potret besar final.                   |
| `gallery-01.png` sampai `gallery-04.png` | 154×205; 207×275; 122×162; 193×258 | Pembesaran akan kehilangan ketajaman.                                         |
| `photos/opened page.png`                 | 412×917                            | Ekspor komposisi Figma; resolusi lebih besar tidak menjadikannya foto bersih. |

P: mintalah foto asli JPG/JPEG, PNG atau WebP, idealnya sisi panjang minimal 2000 px; satu pilihan portrait hero, satu landscape desktop bila tersedia, dua portrait profil, empat foto galeri. Ini target editorial yang diusulkan, bukan aturan upload backend. Simpan original tanpa ditimpa; buat turunan responsive, record focal point dan review crop 390×844 serta 1440×900. Tidak memperbesar foto kecil lalu mengklaimnya sebagai detail asli.

Tidak ditemukan bukti foto bersih beresolusi tinggi pada aset aktif yang dipetakan. Belum dilakukan pencarian seluruh drive atau folder pribadi lain. Foto asli mungkin tersedia di luar area yang diperiksa. Mock boleh dipakai untuk komposisi lokal, tetapi penggantian foto harus mengikuti manifest path/focal point agar tidak perlu mengubah logika aplikasi.

## 7. Usulan pengalaman original

Urutan yang diusulkan: **amplop → hero foto → sapaan → mempelai → tanggal/acara → parkir/rundown bila published → dress code → RSVP → galeri/ayat → quote → pesan → penutup**. QR ditampilkan pada konteks konfirmasi RSVP/pass yang sudah ada, bukan section dekoratif berisi QR tiruan.

Mobile: layar foto pembuka dominan, kemudian satu alur scroll native. Body sekitar 16 px, section cream lapang, judul serif navy, script hanya untuk aksen. Foto tidak perlu dipaksa grayscale. Tidak semua section perlu setinggi layar. Form RSVP tetap berada pada permukaan solid agar label/error terbaca.

Desktop: usulan panel identitas foto di kiri dan isi di kanan pada breakpoint sekitar 1024 px. Panel foto memakai sumber/crop yang memang layak. Pilihan awal adalah scroll dokumen native dengan panel kiri sticky; tidak langsung memakai dua area scroll bersarang. Pada tablet/landscape pendek gunakan satu kolom apabila panel mengurangi keterbacaan. Breakpoint dan rasio kolom harus diuji, bukan dianggap hasil ukur Katsudoto.

Transisi usulan: amplop 600–900 ms; pengenalan hero 500–700 ms; section reveal 400–600 ms dengan perpindahan 12–20 px; kontrol 150–200 ms. Angka ini milik desain kita. Reveal satu kali, konten tetap visible bila enhancement gagal, dan tidak mengulang animasi saat form rerender. Reduced motion menghilangkan travel/zoom/parallax dan tidak menunda akses isi. Tidak ada scroll hijacking atau efek wajib yang menahan RSVP.

Navigasi usulan berupa tautan Acara / RSVP / Galeri, hanya jika target tersedia. Tambahkan setelah isi dibuka; sediakan offset agar heading tidak tertutup. Musik opsional memerlukan file legal milik owner dan play/pause yang terlihat; default belum memasukkan audio. Story, gift, livestream, video, particles dan fitur katalog lain tidak otomatis masuk scope.

## 8. Arsitektur yang diusulkan

| Lapisan                              | Tanggung jawab dan batas                                                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server route `/i/[publicCredential]` | Tetap mengambil data melalui boundary yang sudah ada, no-store, penanganan unavailable generik. Tidak mengubah credential/authorization.                                        |
| Konten editorial statis              | Nama/ayat/quote/dress code milik pasangan dapat dipisah ke konfigurasi bertipe jika membantu review. Bukan CMS; event eligibility, deadline dan pass tidak dipindahkan ke sini. |
| Tema tunggal                         | CSS variables + manifest aset/focal point; satu tema Jo & Venta. Tidak memerlukan schema database atau registry banyak template.                                                |
| Komposisi section                    | `public-invitation-long-page.tsx` menyusun presentational sections, menyisipkan form dan published venue renderer yang ada. Pemisahan file dilakukan secukupnya.                |
| Opening client island                | State closed/opened/content tetap eksplisit; transisi, anti-double-activation, fokus dan scroll reset menjadi tanggung jawabnya. Tidak menyimpan token atau status RSVP.        |
| Motion enhancement                   | CSS/IntersectionObserver atau Motion bila benar-benar diperlukan. Tidak menjadi prasyarat akses teks/form.                                                                      |
| RSVP, pesan, QR                      | State machine dan generated API client existing tetap authority; perubahan hanya visual, dengan recovery dan pending states tetap jelas.                                        |
| Galeri                               | Data asset milik owner + layout responsive; native dialog/lightbox existing dan kontrol keyboard dipertahankan.                                                                 |
| Materi acara                         | Published backend content + renderer bersama admin/publik. Restyle mengikuti renderer dan eligibility existing; draft/invalid tidak bocor.                                      |

Awal pengerjaan cukup di `apps/invitation-web/**` dan dokumentasi. Backend, generated API, admin guest management dan scanner bukan target redesign ini. Bila muncul kebutuhan kontrak baru, jadikan task terpisah sebelum perubahan, bukan perluasan tersembunyi.

## 9. Target mutu dan unknowns

P: kontrol penting minimal 44×44 CSS px sebagai target usability project; ini lebih besar daripada minimum WCAG 2.2 SC 2.5.8 sebesar 24×24 dengan pengecualian. Focus visible, pembacaan 200% zoom, keyboard, contrast, dialog, dan screen-reader status harus diuji. [W3C Target Size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

P: hormati reduced motion dan jangan mengasumsikan audio autoplay berhasil. [MDN reduced motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion), [MDN autoplay](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay).

P: target lapangan nantinya LCP ≤2.5 s, INP ≤200 ms, CLS ≤0.1 pada p75; ini tujuan, belum ada pengukuran produksi project atau benchmark vendor. Test build lokal yang sudah ada memakai ambang berbeda dan hanya mengukur opening. Perlu mengukur perjalanan setelah tombol buka, hero, scroll dan input RSVP agar animasi tidak menyembunyikan masalah. [Core Web Vitals thresholds](https://web.dev/articles/defining-core-web-vitals-thresholds).

| Unknown                                                         | Dampak                                                             | Cara menutup                                                                   |
| --------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Foto original dan hak penggunaan                                | Mutu hero/profil desktop tidak dapat difinalkan.                   | V02: pemetaan file, resolusi, asal dan crop.                                   |
| Final ejaan/gelar keluarga, deadline dan footer                 | Risiko copy salah walau visual bagus.                              | V01: matriks isi dan keputusan owner.                                          |
| Motion prototype Figma                                          | Screenshot statis tidak menjelaskan interaksi/timing.              | V04: storyboard asli; tidak mengklaim Figma memberi spesifikasi motion.        |
| Seluruh template/vendor backend                                 | Sampel tidak mewakili semua desain dan admin.                      | Di luar kebutuhan redesign personal ini.                                       |
| Easing, frame rate, computed styles dan mekanisme scroll vendor | Tidak dapat merekonstruksi implementasi secara pasti.              | Tidak diperlukan untuk membangun perilaku original; ukur implementasi sendiri. |
| Safari/iOS, Android perangkat nyata, jaringan lambat            | Chromium headless tidak membuktikan pengalaman perangkat tersebut. | V19–V21: QA perangkat sebelum final.                                           |
| Musik/video/story/gift                                          | Belum ada materi atau keputusan masuk scope.                       | Backlog opsional, default tidak ditampilkan.                                   |
| Materi parkir/rundown final                                     | Fitur ada tetapi isi belum siap.                                   | Tetap opsional; isi/publish melalui alur existing ketika tersedia.             |
| Hosting/domain                                                  | Tidak diperlukan untuk riset/layout lokal.                         | Deployment adalah pekerjaan terpisah setelah visual dan operasi siap.          |

Riset ini tidak menjalankan ulang test aplikasi dan tidak menerapkan migration. Bukti fungsi existing berasal dari source saat ini dan laporan implementasi sebelumnya; hasil test baru untuk desain baru baru dapat dinyatakan setelah implementasi.
