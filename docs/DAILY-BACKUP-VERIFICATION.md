# Verifikasi backup/restore daily

16 Oktober 2026, Windows, PostgreSQL 18 pada container daily milik proyek. Scope: tooling manual backup/integrity/restore/cleanup dan runbook. Tidak ada perubahan UI, schema/migration, OpenAPI, generated client atau dependency.

## Gate yang dijalankan

| Gate                        | Hasil                                                                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm local:test`           | 42 tes tooling lulus; mencakup signature, file integrity, immutable manifest publication, path boundary dan pre-cancelled transfer |
| `pnpm local:lint`           | Lulus, mencakup seluruh tooling MJS                                                                                                |
| `pnpm lint`                 | 5 task workspace lulus melalui cache; source aplikasi tidak berubah                                                                |
| `pnpm local:verify:backups` | 20 kelompok pemeriksaan selesai exit 0, 49.484 detik termasuk provisioning/cleanup                                                 |
| CLI daily nyata             | Backup → integrity check → restore → cleanup lulus, 8.691 detik; hash semua row/config sumber tidak berubah                        |

API compiled dari build sebelumnya digunakan oleh fixture/backend rehearsal. Build/typecheck aplikasi dan browser visual tidak diulang karena seluruh source aplikasi sama dengan baseline slice. Root formatter memiliki temuan lama yang dicatat di `EVENT-MANAGEMENT-VERIFICATION.md`; slice ini memakai pemeriksaan format terhadap file yang disentuh.

## Bukti runtime

| Skenario                             | Bukti                                                                                                                                                                                     |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backup lengkap QA                    | Signed manifest/config dan archive mencakup seluruh 17 tabel, termasuk RSVP/pass/check-in, pesan dan byte materi                                                                          |
| Restore lengkap                      | Fingerprint seluruh row dan migration history cocok dengan exported snapshot; source QA tidak berubah oleh restore/perjalanan QR                                                          |
| Credential/QR setelah restore        | Public RSVP mengembalikan QR yang sama; staff login berhasil; validate/confirm QR memberi 200/201; duplicate confirm 409; satu record dengan jumlah/operator benar persisted pada salinan |
| Write bersamaan                      | Backup ditahan sesudah export snapshot; pesan baru ditulis ke QA. Dump dan manifest sama-sama mengecualikan pesan baru, lalu restore lolos semua fingerprint                              |
| File corrupt                         | Checksum gagal sebelum database target dialokasikan                                                                                                                                       |
| Secret/config/migrasi tidak cocok    | Ditolak sebelum restore; source identity palsu/port database lama juga ditolak sebelum penulisan bundle                                                                                   |
| Archive autentik tetapi invalid      | Archive QA sengaja diganti dengan header custom + data invalid, metadata ditandatangani ulang oleh test. Real pg_restore gagal, receipt FAILED dipertahankan, cleanup eksplisit berhasil  |
| Active clients dan receipt tampering | Cleanup menolak koneksi target yang masih hidup dan receipt yang diarahkan ke daily, meskipun test menandatanganinya ulang; tidak ada DROP sumber atau terminasi koneksi                  |
| Respons cleanup/target absen         | Pembacaan exact membuktikan target tidak ada; cleanup berikutnya menghasilkan RESTORE_ALREADY_ABSENT                                                                                      |
| Proses backup diputus                | ChildProcess QA exact dihentikan saat transaksi snapshot menunggu lock sebelum dump. Manifest selesai tidak diterbitkan; partial bundle tidak lolos integrity check                       |
| Transport/permission failures        | Rehearsal existing PG18 dump/restore tetap lulus; tool hilang dan OS write-denial menolak sukses, membersihkan resource QA yang diketahui, serta mempertahankan hash sumber               |
| Windows cleanup failure              | File handle QA yang sengaja ditahan membuat cleanup gagal; identitas dipertahankan dan recovery eksplisit hanya menghapus directory QA miliknya                                           |

Deep rehearsal memakai database QA disposable dan bundle yang terikat metadata operasi signed ke nama QA run. Semua salinan database hasil restore dari test dibersihkan melalui ownership guard. Bundle harian nyata tidak ikut cleanup QA. Seluruh assertion selesai sebelum output sukses verifier; tidak ada simulated provider yang dipakai sebagai pengganti PostgreSQL nyata.

## Backup harian yang disimpan

Backup terbaru: `.local-daily/backups/fe7ebc87-d137-4870-8c3d-0f84802208b8`, archive 53.489 byte, 17 tabel. CLI nyata menghasilkan BACKUP_COMPLETE, BACKUP_INTEGRITY_VERIFIED dan RESTORE_VERIFIED; salinan restore uji kemudian dihapus melalui RESTORE_REMOVED. Dataset daily saat pemeriksaan berisi 0 admin, 2 acara mock dan 0 undangan. Tidak ada akun/tamu sintetis ditanam di daily.

Bukti privat: `.local-daily/verification-backups.json`, `.local-daily/backup-live-verification.json`, signed manifest dan receipts. Recovery config berisi secret/password; jangan membuka atau membagikannya dalam laporan publik.

## Penutupan scope dan unknown

Seluruh 72 aset public/original dan semua file di `apps/**` tetap sama SHA-256 terhadap baseline sesi. Schema, migrasi, OpenAPI/client, lockfile, Turbo dan CI sama. Worktree sudah dirty sebelum slice; perubahan sebelumnya dipertahankan. Branch `fix/checkin-manual-status-reconciliation`, HEAD `6bb089bf89ca36752c87a20d6625519101f3b42e`, index kosong. Tidak ada staging, commit atau deployment.

Paket memiliki ACL privat dan HMAC/checksum, belum enkripsi di level tool. Retensi adalah panduan manual: tool tidak menghapus backup lama atau menjadwalkan pekerjaan. Source/foto/font proyek disimpan terpisah dari archive database. Belum dibuktikan: restore lintas mesin/locale/versi schema, power loss, filesystem fsync durability, disk benar-benar penuh, interupsi saat commit final restore, scheduler/remote storage, production HTTPS dan kamera Android/iPhone. Timeout dapat mempertahankan target/receipt untuk pemeriksaan; tidak ada klaim cleanup ketika ownership/client masih belum jelas.

Durasi di atas adalah wall-clock workflow pada mesin ini; cold/warm, throughput data besar, CPU, peak memory dan token tidak dibenchmark. Fingerprint row dibaca bertahap dan archive di-stream; tidak ada klaim peningkatan performa kuantitatif.
