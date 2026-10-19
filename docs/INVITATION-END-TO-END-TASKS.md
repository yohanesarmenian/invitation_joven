# Task transisi, backend undangan, QR, dan scanner staff

Tanggal: 16 Oktober 2026, Asia/Jakarta. Status eksekusi: **implementasi dan automated QA selesai; T12 kamera Android fisik masih terbuka**. Hasil dan batas bukti tercatat di [laporan verifikasi](INVITATION-END-TO-END-VERIFICATION.md); langkah perangkat di [panduan Android](INVITATION-ANDROID-REHEARSAL.md). Bagian kondisi di bawah mempertahankan fakta pada saat perencanaan.

Target: pengalaman membuka undangan yang halus, input tamu tersimpan di backend nyata, QR yang dapat dibaca, dan check-in melalui akun CHECKIN_STAFF yang menghasilkan tepat satu catatan kehadiran per undangan/acara.

## Kondisi yang diamati

| Area              | Bukti source/runtime saat perencanaan                                                                                                             | Makna untuk pengerjaan                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preview saat ini  | Listener lokal 3000 dan mock API 4010 aktif; 3001/4000 tidak terlihat pada pemeriksaan port                                                       | Preview visual belum menjadi bukti integrasi API nyata. Status port hanya berlaku pada saat pemeriksaan.                                                              |
| Transisi          | `invitation-opening-flow.tsx`: timer opening 1200 ms dan entry 650 ms; stylesheet juga memuat timing sendiri serta aturan reveal lama/baru        | Rapikan satu sumber timing dan buktikan kontinuitas visual, kesiapan gambar, pembatalan, serta reduced motion. Adanya beberapa timing belum membuktikan bug tertentu. |
| Input tamu        | `src/server/public-rsvp.ts` memakai GET/PUT `/api/public/invitations/{publicCredential}/rsvp`; `public-guest-message.ts` memakai POST `/messages` | Integrasi sudah tersedia. Perlu dijalankan ulang terhadap API nyata + PostgreSQL setelah revisi UI.                                                                   |
| QR tamu           | `guest-checkin-pass.tsx` merender `pass.qrPayload` dengan qrcode.react, 240 px, margin empat modul, hanya untuk ACTIVE pass                       | Ada renderer, tetapi ukuran/markup saja belum membuktikan hasil gambar dapat didekode oleh scanner staff.                                                             |
| Hak staff         | `checkin.controller.ts`: OWNER dan CHECKIN_STAFF diizinkan pada endpoint check-in; route `/checkin` sudah menampilkan workspace                   | Scanner staff sudah ada. Catatan lama bahwa route masih placeholder tidak berlaku pada source yang diperiksa.                                                         |
| Scanner           | `checkin-camera.tsx` memakai ZXing, kamera belakang sebagai preferensi, validasi pola, stop setelah decode, serta cleanup stream                  | Tidak perlu membangun scanner dari nol. Uji kesesuaian dengan QR dari halaman tamu dan perangkat nyata.                                                               |
| Tes kamera        | `e2e/checkin.e2e.ts` menyediakan QR sintetis melalui canvas stream dan memastikan decode hanya memicu validasi                                    | Bukti coverage tersedia di source, menggunakan mock API. Tes ini tidak dijalankan ulang dalam sesi perencanaan.                                                       |
| Tes backend nyata | `e2e-real/checkin.e2e.ts` mengisi string QR untuk OWNER, menguji staff manual, dan race OWNER/staff dengan input kode                             | Ada coverage persisted state, tetapi jalur kamera staff terhadap QR yang baru dibuat melalui RSVP perlu digabung menjadi satu skenario.                               |
| Data check-in     | Schema memiliki unique `(invitationId,eventId)`; service memvalidasi RSVP/event dan jumlah hadir serta menyimpan operator dari sesi               | Pertahankan kontrak sekali konfirmasi per household/acara dan buktikan race melalui PostgreSQL nyata.                                                                 |
| Recovery          | Client menyediakan `validateQr` serta exact `readManualStatus`; confirmation failure bisa berstatus uncertain                                     | Jangan replay konfirmasi otomatis saat respons hilang. Recovery harus mengacu pada household/acara yang sama.                                                         |

**Batas bukti:** source dan deklarasi tes sudah dibaca; hasil tes terdahulu bukan verifikasi backend versi sekarang. Tes mock, tes API nyata, decoding gambar, dan uji kamera fisik harus dilaporkan terpisah.

## Keputusan yang sudah tetap

- Figma menjadi acuan isi/nama/pertanyaan; halaman memenuhi layar dan galeri memakai komposisi original berdasarkan arah riset REA.
- Foto original dan aset yang disetujui dipertahankan; kode/foto vendor tidak disalin.
- Pasangan menggunakan jatah plus one yang sama: satu pilihan, satu tamu tambahan. Spouse yang sudah menjadi named invitee tidak dihitung ulang.
- RSVP, event eligibility, tenggat, kuota, pass dan operator berasal dari kontrak/backend. Mock tidak menjadi fallback diam-diam saat API nyata gagal.
- QR undangan/check-in merupakan QR dua dimensi. QR publik untuk membuka undangan berbeda dari credential pass check-in.
- Scan menampilkan hasil validasi terlebih dahulu. Staff mengonfirmasi jumlah hadir secara eksplisit.
- Satu record check-in per household/acara adalah perilaku saat ini; scan ulang tidak menambah kehadiran.

## Urutan dan status task

Semua task di bawah **belum dimulai sebagai slice implementasi/verifikasi ini**. Inspeksi awal untuk menyusun backlog sudah dilakukan. P0 adalah integritas alur/data; P1 adalah kualitas interaksi. Urutan eksekusi mengikuti nomor, dengan checkpoint hasil tiap slice.

| ID  | Prioritas                 | Task                                         | Bergantung pada | Output utama                                     |
| --- | ------------------------- | -------------------------------------------- | --------------- | ------------------------------------------------ |
| T00 | P0                        | Baseline dan kontrak kerja                   | —               | Snapshot source, peta kontrak, matriks bukti     |
| T01 | P0                        | Stack QA backend nyata terisolasi            | T00             | API, public web, admin web, PostgreSQL QA        |
| T02 | P1                        | Haluskan opening dan transisi cover          | T00             | Motion timing terpadu dan transisi tanpa flash   |
| T03 | P1                        | Haluskan scroll/reveal                       | T02             | Ritme reveal, fallback dan keyboard yang stabil  |
| T04 | P0                        | Buktikan RSVP tersimpan                      | T01             | Browser → API → baris RSVP/attendee/event        |
| T05 | P0                        | Buktikan pesan tersimpan                     | T01             | Browser → API → GuestMessage                     |
| T06 | P0                        | Buktikan QR dapat dibaca dan lifecycle benar | T04             | Decode gambar QR dan validasi pass nyata         |
| T07 | P0                        | Buktikan login/hak CHECKIN_STAFF             | T01             | Staff siap check-in dengan akses terbatas        |
| T08 | P0                        | Verifikasi scanner dan confirmation staff    | T06, T07        | Decode → preview → confirm → record              |
| T09 | P0                        | Satukan alur tamu sampai staff               | T04–T08         | Satu tes lintas aplikasi dengan QR hasil RSVP    |
| T10 | P0                        | Recovery dan penolakan yang benar            | T09             | Tidak ada blind retry atau data stale            |
| T11 | P0                        | Race dan pencatatan kehadiran                | T09             | Bukti PostgreSQL, satu record dan operator benar |
| T12 | P0 untuk penggunaan venue | Uji kamera perangkat fisik                   | T08–T11         | Matriks perangkat dan simulasi operasional       |
| T13 | P0                        | Penutupan verifikasi dan runbook             | T02–T12         | Laporan hasil, gap tersisa, petunjuk staff       |

## Detail task dan kriteria selesai

### T00 — Baseline dan kontrak kerja

1. Rekam HEAD, branch, staged/unstaged/untracked, status proses/port serta hash aset referensi. Worktree saat inspeksi sudah berisi banyak pekerjaan; pisahkan perubahan slice baru dari pekerjaan sebelumnya.
2. Petakan route tamu, server action, generated DTO, endpoint RSVP/messages/pass/check-in, guard auth/CSRF dan tabel penyimpanan.
3. Cocokkan konfigurasi mock, API nyata dan test harness; catat asal data yang ditampilkan tiap preview.
4. Rekam baseline video/screenshot opening, entry, scroll dan form menggunakan household sintetis tanpa pass aktif.
5. Tetapkan matriks kasus positif/negatif, serta lokasi evidence yang tidak merekam credential atau QR aktif.

**Selesai jika:** sumber data/kontrak setiap layar jelas; snapshot memungkinkan audit diff; setiap task punya skenario dan expected result. Tidak ada migrasi atau rewrite backend tanpa gap konkret.

### T01 — Stack QA terisolasi

1. Pilih PostgreSQL lokal terisolasi yang lulus guard fixture (`invitation_qa_*`, `invitation_ci`, atau `invitation_workflow_smoke` sesuai harness terkait); jangan arahkan fixture/reset ke database kerja.
2. Periksa kebutuhan migration history dan secret konsisten untuk QA tanpa mencetak nilai secret. Schema yang sudah ada cukup sampai terbukti sebaliknya.
3. Siapkan OWNER, CHECKIN_STAFF, household sintetis, named invitee, dua eligible events, kuota companion/children dan tenggat masa depan.
4. Buat mode test/preview yang jelas. Jika mock preview dipertahankan, usulkan port real stack terpisah seperti public 3100/admin 3101/API 4100 setelah pengecekan ketersediaan; parameterkan origin, rewrite dan test URL secara konsisten.
5. Jalankan harness secara serial bila memakai counter/fixture yang sama. Pemeriksaan browser manual tidak boleh mencampuri counter suite yang sedang berjalan.
6. Rekam health API/database serta fixture cleanup yang hanya menyentuh data milik run tersebut.

**Selesai jika:** real stack terbukti terhubung ke database QA, browser tidak merutekan API ke 4010, dan fixture dapat dibersihkan tanpa mengganggu data/preview lain.

### T02 — Opening dan transisi cover lebih halus

Scope utama: `invitation-opening-flow.tsx`, `invitation-cover.tsx`, `figma-invitation-theme.css`.

1. Konsolidasikan timing/easing aktif; rapikan aturan lama yang sudah tidak dipakai, termasuk lapisan base yang tidak lagi dirender.
2. Selaraskan akhir state dengan selesainya animasi/transition yang relevan, dengan timeout fallback untuk pembatalan atau event yang tidak datang.
3. Pastikan foto hero sudah siap didekode sebelum terlihat; siapkan jalur loading dan error/fallback agar tidak ada flash putih atau foto muncul terlambat.
4. Haluskan overlap lipatan → foto dan cover → konten; hindari unmount mendadak, loncatan tinggi layout dan reset scroll yang terlihat.
5. Uji klik berulang, Enter/Space, navigasi keluar/unmount, perubahan reduced motion dan pilihan animasi lintas tab saat transisi berjalan.
6. Pertahankan full viewport, seal proporsional, focus transfer dan pilihan motion yang tersimpan. Akses konten tidak boleh bergantung pada gambar/animasi berhasil.

**Selesai jika:** rekaman normal dan jaringan lambat menunjukkan transisi berkesinambungan, tanpa frame kosong/loncatan; keyboard tetap usable; reduced motion tidak tersangkut dalam state opening. Durasi final dipilih melalui review visual, bukan sekadar memperpanjang timer.

### T03 — Scroll/reveal dan ritme halaman

1. Definisikan gerakan yang konsisten untuk judul, profil, foto dan ornamen; usulan awal perpindahan 12–20 px dan durasi 500–750 ms, kemudian review secara visual.
2. Gunakan stagger secukupnya pada foto/teks terkait; jangan membuat semua elemen bergerak sekaligus atau mengulang reveal saat form rerender.
3. Pastikan konten tetap terlihat ketika observer tidak tersedia/gagal. Elemen yang menerima fokus harus langsung terlihat.
4. Jangan menganimasikan posisi/ukuran form input, pesan error, QR atau area konfirmasi yang sedang dipakai.
5. Verifikasi scroll dokumen native, tidak ada horizontal shift, tidak ada scroll hijacking, dan kontrol animasi tidak menutupi konten.
6. Ukur layout shift dan respons lokal pada build dengan jaringan/CPU yang disepakati; pisahkan metrik lab dari performa perangkat/lapangan.

**Selesai jika:** opening/scroll terasa satu rangkaian, teks dapat dibaca tanpa menunggu reveal, fokus aman, serta tidak ada overflow atau pergeseran tak disengaja pada ponsel/desktop.

### T04 — RSVP browser → API → PostgreSQL

1. Kirim RSVP dari UI terbaru melalui server action dan API nyata, bukan request test yang menggantikan form.
2. Buktikan persisted RSVP status/version, named attendees, satu PLUS_ONE untuk spouse/companion, jumlah anak, dietary notes serta pilihan/jumlah per event.
3. Uji create, reload, edit dan decline. Nilai setelah reload harus berasal dari backend, bukan draft browser.
4. Uji kuota dilarang, jumlah melebihi batas, event tidak eligible, deadline lewat dan stale `expectedVersion`.
5. Pastikan pending tidak mengirim ganda; konflik mempertahankan draft dan meminta review; kegagalan tidak menampilkan sukses palsu.
6. Cocokkan hasil pada read model OWNER dan database QA. Gunakan boolean/hash untuk bukti isi privat; jangan masukkan raw guest data ke log/report.

**Selesai jika:** nilai yang disimpan persis sesuai pilihan yang sah, total attendee konsisten, spouse menambah tepat satu, dan kasus invalid tidak mengubah data.

### T05 — Pesan browser → API → PostgreSQL

1. Uji pesan bernama/anonim, multiline, Unicode, trimming dan batas panjang melalui UI terbaru.
2. Cocokkan isi tersimpan dan jumlah GuestMessage menggunakan bukti fixture yang aman.
3. Uji klik berulang saat pending, error validasi, unavailable invitation dan respons hilang.
4. Pastikan sukses hanya setelah respons valid; jangan mengirim ulang POST otomatis ketika hasilnya tidak pasti. Dua kiriman eksplisit tetap merupakan dua pesan.
5. Buktikan OWNER dapat membaca pesan sesuai aksesnya; CHECKIN_STAFF tidak memperoleh akses messages.
6. Uji input yang tampak seperti HTML/script agar tidak dieksekusi/diinjeksi ke confirmation UI.

**Selesai jika:** pesan sah tersimpan dan terbaca sesuai hak, tidak ada duplikasi karena pending/automatic retry, dan teks tamu diperlakukan sebagai teks.

### T06 — QR render, decoding dan lifecycle

1. Setelah accepted RSVP melalui UI, ambil QR yang benar-benar dirender oleh halaman tamu.
2. Decode raster hasil renderer secara lokal; bandingkan hasilnya dengan canonical pass di memori tanpa mencetak credential. Pemeriksaan DOM/path SVG saja tidak cukup.
3. Uji minimum ukuran efektif, quiet zone empat modul, kontras, rasio persegi, crop dan dekorasi pada berbagai viewport.
4. Buktikan accepted edit mempertahankan pass sesuai kontrak; decline mencabutnya; reaccept menghasilkan pass sesuai lifecycle backend dan QR lama ditolak.
5. Uji unavailable/archived invitation serta pass revoked. Tidak ada QR buatan client ketika backend belum mengeluarkan pass.
6. Buktikan QR/public invitation credential tidak tertukar dan tidak memicu navigasi otomatis ketika dipindai.

**Selesai jika:** QR hasil UI dapat didekode, hasil decode diterima API untuk event yang eligible, dan pass yang tidak sah ditolak. QR aktif tidak masuk screenshot/trace/video artefak.

### T07 — Akun dan batas akses CHECKIN_STAFF

1. Buat staff sintetis melalui workflow yang berlaku dan uji login, first-login password change bila diwajibkan, sesi dan sign-out.
2. Pastikan staff masuk `/checkin`, memperoleh daftar event yang sah dan dapat melakukan validate/confirm.
3. Uji 401 saat sesi berakhir, CSRF/origin ditolak, serta sesi dicabut setelah staff di-disable/reset oleh OWNER.
4. Uji staff tidak dapat membuka dashboard, guest management, RSVP/messages, reports atau staff management di luar kontraknya, termasuk request langsung.
5. Pastikan operator pada CheckinRecord berasal dari sesi server, bukan field yang bisa dipilih client.

**Selesai jika:** akun CHECKIN_STAFF berfungsi untuk check-in dan tetap terbatasi; OWNER QR success tidak dipakai sebagai pengganti bukti staff QR success.

### T08 — Scanner staff → validate → confirm

1. Alirkan QR dari renderer tamu ke scanner ZXing melalui camera stream sintetis, dengan API nyata dan staff session nyata.
2. Pastikan decode satu kali menghentikan stream dan memicu validate; hasil scan sendiri belum mencatat attendance.
3. Tampilkan household/event/expected count; staff memasukkan actual count dan menekan Confirm secara eksplisit.
4. Buktikan record menyimpan event, actual count, method QR, timestamp dan staff operator yang benar; actual count harus 1 sampai expected count event tersebut.
5. Uji QR invalid, URL undangan, kode lama, salah event, event tidak dipilih serta scan ulang.
6. Uji izin kamera ditolak, kamera sibuk/tidak tersedia, pergantian kamera/event, tab disembunyikan, sign-out dan fallback ketik kode/manual search.

**Selesai jika:** real QR + real staff + real API/database berhasil, repeated frames tidak mengirim confirm berulang, dan semua jalur keluar melepas camera tracks.

### T09 — Satu vertical slice lintas aplikasi

1. Seed household yang belum mempunyai accepted RSVP atau pass; jangan seed pass lalu mengklaimnya hasil submit tamu.
2. Buka undangan di guest browser context; isi RSVP dan kirim pesan; buktikan data tersimpan.
3. Ambil QR yang dirender dari accepted response; gunakan credential/gambar hanya di memori test.
4. Login CHECKIN_STAFF pada browser context terpisah; pilih event; decode QR melalui scanner; periksa preview dan tekan Confirm.
5. Cocokkan persisted CheckinRecord dan read model/report OWNER; pisahkan jumlah expected dari actual attendance.
6. Scan lagi pada event yang sama: tampilkan already confirmed, jumlah record tetap satu. Event lain mengikuti eligibility/pilihan RSVP masing-masing.

**Selesai jika:** alur lengkap dapat diulang pada fixture baru tanpa mock API dan tanpa penyuntikan pass/hasil decoder sebagai pengganti proses yang sedang dibuktikan. Sumber media kamera boleh sintetis; real hardware tetap T12.

### T10 — Recovery, data stale dan network failure

1. Putuskan respons sesudah backend menyimpan konfirmasi; UI harus menunjukkan hasil belum pasti, bukan menganggap gagal lalu mengirim lagi.
2. QR recovery memakai validasi ulang pass terhadap event yang sama; manual recovery memakai exact invitationId/eventId `manual-status`, bukan hasil pencarian terbatas.
3. Buktikan hasil NOT_CONFIRMED adalah pembacaan sesaat, bukan izin replay otomatis ketika request sebelumnya mungkin masih berjalan.
4. Uji late validation setelah event/kode berubah; hasil lama tidak boleh mengganti kandidat baru.
5. Uji pass dicabut/RSVP diubah antara preview dan confirm, serta sesi staff habis saat operasi berlangsung.
6. Retain explicit user review sebelum konfirmasi baru; tidak ada offline queue, optimistic attendance atau background retry.

**Selesai jika:** setiap uncertain state punya jalur recovery yang tepat tanpa menambah write; tidak ada success palsu atau kandidat stale yang bisa dikonfirmasi tanpa revalidasi backend.

### T11 — Race PostgreSQL dan attendance integrity

1. Jalankan dua staff/operator yang mengonfirmasi household/event yang sama bersamaan menggunakan PostgreSQL nyata.
2. Uji race QR-vs-QR, QR-vs-manual, serta RSVP edit/decline melawan confirmation sesuai kontrak locking yang ada.
3. Buktikan satu pemenang, satu persisted record, satu jumlah actual yang sah dan attribution operator pemenang.
4. Uji household yang sama pada event berbeda: tidak salah tertahan sebagai duplicate lintas acara jika keduanya eligible.
5. Cocokkan laporan expected/actual/not-arrived agar tidak menggandakan aggregate melalui join.

**Selesai jika:** hasil database dan respons kedua operator konsisten; tidak hanya mengandalkan unit test atau mock untuk membuktikan locking/uniqueness.

### T12 — Kamera fisik dan simulasi operasional

1. Tetapkan perangkat yang benar-benar tersedia: minimal satu Android/Chrome dan satu iPhone/Safari bila keduanya akan dipakai staff.
2. Siapkan origin HTTPS yang dipercaya perangkat atau lingkungan secure yang tepat; akses lewat IP LAN tidak diasumsikan sama dengan localhost di laptop. Jangan melewati peringatan sertifikat.
3. Scan QR dari layar ponsel tamu dan hasil cetak pada jarak/cahaya realistis; periksa autofocus, orientasi dan pergantian kamera.
4. Uji dua staff, QR yang sama, event salah, jaringan terputus, izin ditolak, sesi habis serta fallback manual.
5. Catat perangkat/browser aktual, kondisi, hasil dan batasan; jangan menyatakan lolos iOS/Android hanya berdasarkan emulasi desktop/canvas stream.

**Selesai jika:** perangkat venue yang ditargetkan lulus simulasi. Jika perangkat belum tersedia, tandai belum diverifikasi; automated local readiness tetap dapat dilaporkan terpisah dari venue readiness.

### T13 — Gates penutup dan runbook

1. Jalankan gates yang relevan: API/backend tests termasuk PostgreSQL, invitation/admin unit tests, mock regressions, real E2E dan unified T09; build/typecheck/lint/format serta contract-generation check bila kontrak berubah.
2. Perintah yang menghasilkan Prisma/generated files dijalankan berurutan; jangan menjalankan suite database yang saling menghapus fixture secara bersamaan.
3. Rekam command, target database yang disamarkan, versi source/HEAD+diff, hasil pass/fail/skip, source-of-data mode dan evidence tanpa credential.
4. Verifikasi aset original utuh, perubahan di luar slice tidak tertimpa, staging kosong bila belum diminta commit, dan preview final menggunakan mode yang jelas.
5. Siapkan panduan staff: login, pilih event, start camera, validate, actual count, Confirm satu kali, already confirmed, recovery, fallback dan sign-out.
6. Laporan akhir memisahkan: verified automated, verified real database, verified physical devices, serta known limitations. Perubahan kode saja tidak cukup menutup task.

**Selesai jika:** seluruh gate yang diperlukan lulus, gap yang tersisa diberi status jelas, dan owner/staff dapat menjalankan rehearsal dari awal tanpa bantuan menebak konfigurasi.

## Matriks acceptance minimum

| Kasus                    | Expected result                                                | Bukti wajib                                      |
| ------------------------ | -------------------------------------------------------------- | ------------------------------------------------ |
| Accept + spouse/plus one | Satu additional attendee, total dan event counts sah           | UI + canonical read + PostgreSQL                 |
| Decline/reaccept         | Pass lifecycle benar; QR lama ditolak                          | API read + pass persistence + scanner validation |
| Kirim pesan              | Pesan tersimpan, confirmation benar, staff tidak dapat membaca | UI + persisted/hash check + authorization        |
| Scan staff pertama       | Preview tidak menulis; confirm membuat satu record             | Decoding + request sequence + PostgreSQL         |
| Scan ulang               | Already confirmed; record/count tidak bertambah                | UI + persisted count                             |
| Dua operator bersamaan   | Satu pemenang, attribution tepat                               | Dua context + PostgreSQL concurrency             |
| Respons confirm hilang   | Uncertain → exact recheck, tanpa automatic replay              | Network fault + write count + persisted read     |
| Salah event/pass revoked | Ditolak tanpa household disclosure yang tidak sah              | Real API + scanner UI                            |
| Kamera gagal             | Alasan jelas, fallback tersedia, tracks dilepas                | Browser automation + perangkat fisik             |
| Reduced motion/toggle    | Tidak tersangkut, input/fokus tetap aman                       | Browser state + motion QA tanpa QR aktif         |

## Keputusan/unknown sebelum venue-ready

- Owner menyatakan Android dan iPhone tersedia, serta memilih Android untuk uji pertama. Jaringan/HTTPS venue belum ditetapkan; hasil kamera fisik belum tersedia.
- Perlu menegaskan prosedur keluarga yang datang terpisah. Kontrak sekarang sekali check-in per household/event; menambah arrival parsial atau koreksi attendance merupakan scope/kontrak baru, bukan tambahan diam-diam pada scanner.
- Final venue, materi parkir/rundown, klaim makanan dan hosting produksi tetap mengikuti review owner; preview Figma bukan publikasi final.
- Kesiapan API/database terbaru dan kamera fisik belum dibuktikan oleh inspeksi perencanaan ini.

## Titik masuk source

- Motion: `apps/invitation-web/components/invitation/invitation-opening-flow.tsx`, `invitation-cover.tsx`, `figma-invitation-theme.css`.
- Form dan API adapter: `public-rsvp-form.tsx`, `guest-message-form.tsx`, `src/server/public-rsvp.ts`, `src/server/public-guest-message.ts`.
- Pass: `guest-checkin-pass.tsx`; public real smoke: `apps/invitation-web/e2e-real/public-invitation-real-backend.smoke.e2e.ts`.
- Staff: `apps/admin-web/app/checkin/page.tsx`, `components/checkin-workspace.tsx`, `components/checkin-camera.tsx`, `src/checkin/client.ts` dan `contract.ts`.
- Backend: `apps/api/src/checkin/checkin.controller.ts`, `checkin.service.ts`, `dto/checkin.dto.ts`, `checkin.http.integration.spec.ts`; schema `apps/api/prisma/schema.prisma`.
- Harness: `apps/admin-web/e2e/checkin.e2e.ts`, `e2e-real/checkin.e2e.ts`, `playwright.real.config.ts`, `apps/api/scripts/admin-workflow-fixture.ts` dan public smoke fixture/global setup.
- Operasional: `docs/LOCAL-OPERATIONS.md`; keputusan visual terkini: `docs/design/jo-venta/FIGMA-FIDELITY.md`.

Repository saat inspeksi: HEAD `6bb089bf89ca36752c87a20d6625519101f3b42e`, worktree dirty berisi pekerjaan sebelumnya. Sesi ini menyusun task/document saja; tidak menjalankan test backend, mengubah kode aplikasi, memigrasi database, membuat akun atau mengganti server preview.
