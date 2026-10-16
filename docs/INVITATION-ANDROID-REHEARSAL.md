# Rehearsal Android: undangan, RSVP, QR dan scanner staff

Target pertama adalah Android/Chrome sesuai pilihan owner. iPhone/Safari belum diuji. Kamera sintetis desktop membuktikan decoder dan integrasi, bukan autofocus atau izin kamera perangkat fisik.

## Menjalankan stack QA

Jalankan dari `D:\Projects\invitation_joven`. Helper membaca `apps/api/.env` secara privat, memakai server PostgreSQL loopback yang sama, lalu mengganti **nama database saja** dengan nama QA eksplisit. Ia tidak membuat database, memigrasi, mencetak secret, atau memakai database kerja sebagai fallback.

Database yang sudah dibuat dan dimigrasi pada sesi ini: `invitation_qa_20261016_journey`. Jangan jalankan suite API yang membersihkan tabel bersamaan dengan rehearsal atau browser real E2E.

Build API lebih dahulu:

```powershell
rtk proxy pnpm --filter api build
```

Pada empat terminal terpisah, tetapkan variabel berikut di **masing-masing terminal**, lalu jalankan satu mode:

```powershell
$env:INVITATION_QA_DATABASE_NAME = 'invitation_qa_20261016_journey'
rtk proxy node ops/local-journey.mjs api
```

```powershell
$env:INVITATION_QA_DATABASE_NAME = 'invitation_qa_20261016_journey'
rtk proxy node ops/local-journey.mjs admin
```

```powershell
$env:INVITATION_QA_DATABASE_NAME = 'invitation_qa_20261016_journey'
rtk proxy node ops/local-journey.mjs guest
```

```powershell
$env:INVITATION_QA_DATABASE_NAME = 'invitation_qa_20261016_journey'
rtk proxy node ops/local-journey.mjs fixture
```

Alamat staff: `http://localhost:3101/login`; public invitation: port 3100; API: port 4100. Port 3000/4010 tetap preview visual dengan mock API. Folder output `.next-journey` terpisah dari preview. Jangan menjalankan build atau real E2E yang memakai folder QA yang sama saat rehearsal aktif.

Fixture membuat household tanpa RSVP/pass, satu event, OWNER dan CHECKIN_STAFF sintetis. Tautan personal dan login sintetis disimpan di ignored `apps/admin-web/.local-journey.json`; baca sendiri di komputer, jangan commit atau salin ke laporan/screenshot. Password fixture adalah data uji, tidak boleh dipakai untuk akun sungguhan.

Biarkan terminal fixture terbuka. Ketik `cleanup` lalu Enter atau gunakan Ctrl+C untuk menghapus hanya fixture miliknya beserta file privat. Stop server lain sesudah cleanup. Jika proses ditutup paksa, data sintetis mungkin tertinggal; file yang tertinggal tidak ditimpa otomatis. Jangan menghapus atau membersihkan database kerja untuk mengatasi kondisi itu.

Untuk mengulang suite otomatis pada QA database yang sama, hentikan server/rehearsal lebih dahulu:

```powershell
$env:INVITATION_QA_DATABASE_NAME = 'invitation_qa_20261016_journey'
rtk proxy node ops/local-journey.mjs test
```

## Menghubungkan Android melalui USB

Chrome mendokumentasikan port forwarding USB dari localhost Android ke localhost komputer dalam [panduan resmi port forwarding](https://developer.chrome.com/docs/devtools/remote-debugging/local-server/#case-2-set-up-port-forwarding-through-usb-for-your-android-device). Setup ini tidak memerlukan membuka API langsung ke ponsel.

1. Hubungkan Android melalui USB dan aktifkan remote debugging dengan persetujuan perangkat milikmu. Pastikan perangkat muncul di `chrome://inspect/#devices` pada Chrome komputer.
2. Aktifkan Discover USB devices. Buka Port forwarding dan aktifkan forwarding.
3. Tambahkan device port `3101` ke `localhost:3101`, serta `3100` ke `localhost:3100`.
4. Di Chrome Android, buka `http://localhost:3101/login`. Gunakan hostname **localhost** yang sama agar origin sesuai konfigurasi, bukan IP LAN.
5. Mulai kamera secara eksplisit dan izinkan akses saat diminta. Jika browser menyatakan origin tidak secure atau mediaDevices tidak tersedia, hentikan uji kamera dan periksa forwarding/secure context; jangan mengubah flag keamanan atau melewati peringatan sertifikat.

Port forwarding hanya lingkungan development. Penggunaan venue melalui jaringan membutuhkan origin HTTPS yang dipercaya perangkat dan pengujian tersendiri.

## Langkah tamu dan staff

1. Pada komputer atau perangkat tamu lain, buka `guestUrl` dari file privat. Buka amplop dan cover; coba Animations On/Off dan scroll.
2. Pilih Joyfully Accept, Synthetic Guest, satu Wife/Husband **atau** plus one, serta anak jika diikutkan. Pilih event yang sama dengan file fixture dan isi jumlah yang sah. Submit RSVP; QR baru boleh muncul setelah backend menerima.
3. Kirim pesan sintetis. Muat ulang undangan dan pastikan RSVP tersimpan. Jangan membagikan foto QR aktif sebagai bukti.
4. Login sebagai CHECKIN_STAFF di Android. Pilih event fixture, tekan Start camera, arahkan kamera belakang ke QR pada perangkat tamu.
5. Setelah decode, kamera berhenti dan preview household muncul. **Scan belum mencatat kehadiran.** Periksa event dan jumlah expected.
6. Isi People arriving now antara 1 dan expected. Tekan Confirm check-in satu kali; periksa Check-in confirmed.
7. Scan kembali QR yang sama untuk event yang sama. Hasilnya Already confirmed; OWNER dapat mengecek actual attendance di Reports dengan refresh.
8. Sign out dan periksa indikator kamera mati. Staff tidak boleh mengakses dashboard, RSVP/messages, reports, guest management, atau staff management.

Jika respons confirm hilang, gunakan Recheck exact household and event. Jangan mengirim konfirmasi kedua secara otomatis atau berulang. Pembacaan NOT_CONFIRMED hanya keadaan pada saat dibaca. Jika kamera gagal, gunakan input QR atau pencarian household sesuai hak staff.

Satu household hanya dapat dikonfirmasi sekali per event. Misalnya expected tiga dan actual dua, sistem mencatat dua; kedatangan anggota ketiga belakangan **belum memiliki workflow tambah/koreksi**. Jangan menjadikan skenario tersebut prosedur venue tanpa keputusan produk baru.

## Bukti fisik yang masih harus dicatat

| Pemeriksaan                                             | Hasil aktual                                 |
| ------------------------------------------------------- | -------------------------------------------- |
| Model Android, versi OS dan Chrome                      | Belum diuji                                  |
| Izin kamera pertama kali / ditolak lalu diizinkan       | Belum diuji                                  |
| Kamera belakang, autofocus, rotasi dan pemilihan kamera | Belum diuji                                  |
| QR layar: jarak/cahaya/brightness yang realistis        | Belum diuji                                  |
| QR cetak: ukuran dan kualitas cetak                     | Belum diuji                                  |
| Scan ulang: Already confirmed                           | Belum diuji                                  |
| Jaringan putus sebelum/sesudah confirm dan recovery     | Belum diuji                                  |
| Dua staff pada QR/event yang sama                       | Belum diuji fisik; otomatis PostgreSQL lulus |
| Pindah tab/event dan sign-out melepas kamera            | Belum diuji fisik; otomatis browser lulus    |
| iPhone/Safari                                           | Ditunda; Android didahulukan oleh owner      |

Isi hasil dengan waktu, perangkat, kondisi, pass/fail dan keterbatasan tanpa credential. Rehearsal selesai jika bukti perangkat terisi, bukan hanya karena halaman berhasil dibuka.
