# Toko Coquette k6 Lab

Lab performa Toko Coquette dengan frontend Nginx, backend Express dan SQLite, serta k6 di K3s. Metrik k6 dikirim ke Mimir dan ditampilkan di Grafana.

GitHub Actions membangun image frontend dan backend, lalu mengecek homepage, katalog, login, dan profil dengan database sementara. Workflow CI bisa dijalankan tanpa akses ke VM.

Workflow **Prepare K3s release** dipicu manual dari branch `main`. GitHub Actions memeriksa kedua image dan menyimpannya sebagai artifact bertag commit. Untuk menerapkan release dari PowerShell, login ke GitHub CLI lalu jalankan `./deploy/Deploy-Lab.ps1 -RunId <id> -Vm <user@host>`. Perintah memakai akses SSH VM yang sudah ada. Deployment memakai SQLite yang sudah ada dan kembali ke image sebelumnya jika pemeriksaan HTTP gagal.

## Isi repo

- `app/` berisi kode aplikasi, Dockerfile, dan instrumentasi tracing.
- `deploy/` berisi template Deployment dan Service untuk lab. Template memerlukan referensi image dan PVC `petite-bow-sqlite` yang sudah tersedia. Siapkan Alloy dan Mimir sebelum menjalankan tes di cluster.
- `tests/smoke.json` berisi pemeriksaan singkat jalur baca pada lab. Skenario Load dan Stress dengan login menyusul setelah alur CI/CD disiapkan.

SQLite membuat database dan kunci JWT sendiri saat pertama kali dipakai. Jika perlu, isi `JWT_SECRET` dari pengelola secret environment. Simpan database, kredensial, dan hasil pengujian di luar Git.
