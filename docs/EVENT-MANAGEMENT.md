# Pengelolaan acara lokal

Slice 16 Oktober 2026: OWNER mengelola konfigurasi acara melalui **Events** (`/events`). Materi parkir/rundown tetap dikelola melalui **Event materials**, dengan draft dan publication terpisah.

## Pemakaian

1. Jalankan mode daily dan login sebagai OWNER. Buka Events, pilih acara existing atau New event.
2. Isi nama, slug, description, waktu mulai/selesai **WIB**, venue, alamat, Google Maps, urutan dan status aktif. Waktu/tempat yang belum diketahui boleh kosong; aplikasi tidak membuat tanggal atau lokasi pengganti.
3. **Save event** langsung menyimpan konfigurasi acara. Perubahan muncul pada undangan ketika tamu memuat ulang halaman; tab tamu yang sudah terbuka tidak menerima push update.
4. Slug dan display order harus unik. Untuk menukar urutan dua acara, gunakan nilai sementara yang belum dipakai, lalu simpan perubahan satu per satu. Belum ada operasi reorder massal yang atomik.
5. Jika ada konflik editor atau hasil simpan tidak diketahui, draft tetap terlihat dan tombol simpan dikunci. **Reload saved events** membaca keadaan backend; jika draft berubah, dialog meminta persetujuan untuk membuang draft. Tidak ada pengulangan simpan otomatis. Untuk create yang responsnya hilang, periksa daftar acara tersimpan sebelum membuat acara lain.

Description tersimpan dalam konfigurasi OWNER, belum menjadi bagian proyeksi undangan publik. Nama pasangan, foto, font, dress code dan konten Figma tidak diubah oleh editor ini. Jadwal rundown yang dipublikasikan juga tidak otomatis ditulis ulang ketika waktu Event berubah; OWNER perlu meninjau materi itu secara terpisah.

## Aturan perlindungan

| Kondisi                                                                              | Perubahan yang diizinkan                                                                                            | Perubahan yang ditolak                        |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Belum ada link undangan/RSVP/check-in                                                | Semua field                                                                                                         | Slug/order duplikat atau input tidak valid    |
| Sudah ada salah satu referensi, termasuk undangan archived dan pilihan RSVP declined | Nama, description, venue, alamat, Maps, urutan, jadwal sebelum check-in; legacy inactive dapat diaktifkan lewat API | Mengganti slug, menonaktifkan acara aktif     |
| Sudah ada check-in                                                                   | Koreksi deskripsi/nama/tempat/Maps/urutan                                                                           | Mengubah start/end, slug, menonaktifkan acara |

Tidak ada endpoint atau tombol delete. Identitas Event UUID tetap. Penyimpanan tidak mereset RSVP, pass, QR, pesan, invitation eligibility atau catatan check-in. Event version berbeda dari EventContent version.

## Kontrak dan transaksi

- `GET /api/admin/event-management` → `{ items: ManagedEventDto[] }`, urut `displayOrder ASC, id ASC`.
- `POST /api/admin/event-management` → `ManagedEventDto`, HTTP 200.
- `PUT /api/admin/event-management/{eventId}` → `ManagedEventDto`, HTTP 200; replacement penuh dengan `expectedVersion >= 1`.

Semua operasi OWNER-only, no-store, dengan enforcement session/forced-password/role existing. Mutasi memerlukan origin dan CSRF. `GET /api/admin/events` tetap memakai DTO katalog existing supaya picker invitation/import tidak berubah.

Field wajib pada create/replacement: `slug`, `name`, `description`, `startsAt`, `endsAt`, `venueName`, `address`, `googleMapsUrl`, `displayOrder`, `isActive`. Enam field description/waktu/tempat/alamat/Maps menerima null. Slug lowercase alfanumerik dengan pemisah `-`, maksimum 80; nama 200; description/alamat 2000; venue 300; Maps 2048 karakter. Display order integer 0–2147483647. Dates ISO dengan offset eksplisit atau Z; end harus sesudah start. Maps hanya HTTPS tanpa userinfo/custom port pada `google.com/maps`, `www.google.com/maps`, atau `maps.app.goo.gl/<path>`. Field asing, tanggal kalender invalid dan version invalid ditolak 400.

Respons berisi field di atas, `id`, `version`, dan `usage: { invitations, rsvps, checkins }`. Usage adalah jumlah referensi, bukan jumlah orang; preview UI bersifat snapshot. Backend selalu menghitung ulang setelah memperoleh lock saat simpan.

| Respons                      | Arti                                        |
| ---------------------------- | ------------------------------------------- |
| 409 `EVENT_VERSION_CONFLICT` | Versi sudah berubah, perlu reload eksplisit |
| 409 `EVENT_IN_USE`           | Slug/status dilindungi referensi            |
| 409 `EVENT_SCHEDULE_LOCKED`  | Check-in sudah ada                          |
| 409 `EVENT_UNIQUE_CONFLICT`  | Slug atau urutan duplikat                   |
| 400 `VALIDATION_ERROR`       | Input invalid                               |
| 404 `NOT_FOUND`              | UUID valid tetapi acara tidak ada           |

Migration `20261016090000_event_management` menambah `events.version INTEGER NOT NULL DEFAULT 1`. Update mendapat Event `FOR UPDATE`, memeriksa version/usage, lalu increment version dalam transaksi yang sama. Creation/eligibility/import dan confirmation check-in mengambil Event `FOR SHARE` sebelum membaca fakta event yang mutable. Event locks diurut UUID; writer existing memegang invitation lock lebih dahulu jika diperlukan. Management/content tidak mengambil invitation lock. Import mengunci semua event terpilih sebelum membangun graph. RSVP tidak membutuhkan lock baru: referensi InvitationEvent yang dimilikinya sudah melarang deactivation/slug change.

Tanggal besar undangan menggunakan tanggal acara eligible paling awal dalam WIB. Masing-masing kartu juga menampilkan tanggalnya, sehingga acara beda hari tidak tersamarkan. Countdown tetap memilih acara valid berikutnya dan menghilang ketika semuanya selesai/tanpa tanggal. Kalender menggunakan start/end backend. Tidak ada fallback tanggal pernikahan statis.

## Verifikasi dan batas

Jalankan berurutan setelah `pnpm local:down`: `pnpm local:build`, lalu `pnpm local:verify:events`. Runner menerapkan migrasi pending pada database daily miliknya, membuat database QA random, menjalankan suite PostgreSQL dan empat kasus browser, memeriksa data daily tetap sama selama rehearsal, lalu menghapus hanya QA miliknya. Private diagnostics berada di `.local-daily`; jangan membagikan file mentahnya.

Kasus utama: auth/CSRF, CRUD yang diizinkan, nullable fields, invalid payload atomik, uniqueness, dua editor bersamaan, referensi archived, schedule setelah check-in, PostgreSQL lock wait yang diamati melalui `pg_blocking_pids`, create invitation melawan deactivate, management melawan commit link, confirmation staff melawan event lock; browser create/edit/WIB/date/countdown/calendar, stale draft, respons simpan hilang tanpa replay, staff denial dan mobile overflow.

Detail hasil aktual dicatat di `EVENT-MANAGEMENT-VERIFICATION.md`. Pengujian Android fisik, target produksi/HTTPS, materi final dan OWNER daily nyata tetap belum diselesaikan oleh slice ini.
