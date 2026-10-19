# Figma Jo & Venta — aplikasi lokal

Acuan terbaru owner, 16 Oktober 2026: **konten, identitas dan pertanyaan RSVP mengikuti Figma; halaman memenuhi layar; foto prewed memakai komposisi original yang terinspirasi riset REA**. Keputusan ini menggantikan frame tengah 412 px. Tidak ada foto atau kode vendor yang disalin.

- [Pemetaan Figma, implementasi, QA dan perbedaan fungsional](FIGMA-FIDELITY.md)
- [Manifest ekspor Figma lokal](figma-asset-manifest.json)
- [Matriks isi dan data backend](CONTENT-MATRIX.md)
- [Ledger implementasi historis dan runbook](IMPLEMENTATION.md)
- [Riwayat prototype dan revisi](HISTORY.md)

Preview aplikasi: http://127.0.0.1:3000/i/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA (household sintetis). Buka amplop, lalu pilih Open Invitation untuk melihat undangan. Runtime terbaru memakai stylesheet figma-invitation-theme.css. Kontrol Animations mengikuti reduced motion perangkat; owner dapat menyalakannya dan pilihan disimpan sebagai full/reduced, tanpa kredensial.

Mode preview lokal dijalankan dengan `INVITATION_MOCK_PRESENTATION=figma` pada mock API; detail venue dan tautan Maps mengikuti Figma. Ini tidak mengubah fixture tes default atau data backend. Materi parkir/rundown dan status final venue tetap perlu ditinjau owner.

Prototype pada port 4317 merupakan artefak historis. Ia tidak lagi menjadi acuan tampilan atau bukti aplikasi terbaru. Screenshot runtime-* di review/ adalah hasil aplikasi dengan fixture, tanpa saved RSVP/QR aktif.

Enam original gambar-edit dan seluruh aset lama tetap dipertahankan. Folder original `gambar-edit/` diabaikan Git dan tetap lokal; sediakan kembali folder tersebut sebelum regenerasi foto pada checkout baru. Turunan foto runtime dan manifest yang direview tetap disimpan dalam repository. Foto runtime memakai turunan beresolusi tinggi pada wedding-media.generated.ts; thumbnail kecil Figma tidak diperbesar menjadi foto utama. Pipeline ops/prepare-wedding-media.mjs tersedia untuk turunan foto original. Dekorasi dan segel tetap memakai ekspor lokal Figma. Gunakan nama file versi baru setelah penggantian dan periksa ulang crop serta manifest.
