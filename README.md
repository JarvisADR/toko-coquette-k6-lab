# Toko Coquette k6 Lab

Lab performa Toko Coquette dengan frontend Nginx, backend Express dan SQLite, serta k6 di K3s. Metrik k6 dikirim ke Mimir dan ditampilkan di Grafana.

GitHub Actions membangun image frontend dan backend, lalu mengecek homepage, katalog, login, dan profil dengan database sementara. Workflow CI bisa dijalankan tanpa akses ke VM.

Workflow **Prepare K3s release** dipicu manual dari branch `main`. GitHub Actions memeriksa kedua image dan menyimpannya sebagai artifact bertag commit. Dari checkout terbaru, login ke GitHub CLI lalu jalankan `./deploy/Deploy-Lab.ps1 -RunId <id> -Vm <user@host>`. Skrip memakai akses SSH VM yang sudah ada. Deployment memakai SQLite yang sudah ada dan kembali ke image sebelumnya jika rollout atau pemeriksaan HTTP gagal.

Setelah aplikasi siap, skrip otomatis menjalankan **preflight 1 VU → Load Test → Stress Test** di K3s. Tiap tahap menunggu Job sebelumnya lulus. Jika tes gagal, skrip berhenti dan mencetak nama Job serta log terakhir, sementara versi aplikasi yang sudah siap tetap terpasang. Siapkan akun uji dan dependensi di bawah sebelum menjalankan deployment. Sisakan sekitar 45 menit untuk rangkaian k6 dan pertahankan sesi SSH.

## Isi repo

- `app/` berisi kode aplikasi, Dockerfile, dan instrumentasi tracing.
- `deploy/` berisi template Deployment dan Service untuk lab. Template memerlukan referensi image dan PVC `petite-bow-sqlite` yang sudah tersedia. Siapkan Alloy dan Mimir sebelum menjalankan tes di cluster.
- `tests/` berisi dua manifest Job k6. `tests/check-app.sh` memeriksa endpoint untuk CI.
- `monitoring/grafana/dashboards/lab.json` berisi ekspor dashboard lab dengan delapan panel. Untuk memulihkannya, gunakan **Dashboards → New → Import** dan pastikan datasource Mimir memiliki UID `mimir`.

## Load Test dan Stress Test

| Manifest | Beban | Tujuan |
| --- | --- | --- |
| `tests/load-test.json` | 100 VU selama 30 menit | Mengukur RPS aktual dan stabilitas |
| `tests/stress-test.json` | 25 → 50 → 100 → 125 → 150 → 0 VU selama 13 menit 30 detik | Mencari tahap pertama saat latensi atau error melewati ambang, lalu mengamati pemulihan |

Setiap VU mengakses frontend, membuka `GET /`, login lewat `POST /api/auth/login`, membaca `GET /api/auth/me` dengan token login, lalu memanggil `GET /api/products` lima kali sebelum mengulang sesi. Pada tes utama, jeda antaraksi 1–3 detik. Ambang tiap endpoint adalah P95 < 1 detik, request gagal < 1%, dan check lulus ≥ 99%.

Di namespace `k6-lab`, siapkan aplikasi, Mimir, PVC `k6-results`, serta Secret `k6-test-account` dengan key `email` dan `password` milik akun uji yang sudah terdaftar.

### Menjalankan tes secara terpisah

Dari root checkout pada VM, jalankan preflight di Bash dengan `jq` dan `kubectl`.

```bash
set -o pipefail
jq '.metadata.generateName="k6-login-preflight-" | .spec.activeDeadlineSeconds=90 | .spec.template.spec.containers[0].env += [{name:"K6_MODE",value:"preflight"}]' tests/load-test.json \
  | sudo kubectl create -f -
```

Preflight menjalankan 1 VU dan mengecek keempat endpoint. Pastikan Job `Complete` dan log menampilkan `"failedThresholds":[]`. Setelah itu jalankan Load Test. Jalankan Stress Test setelah Load Test selesai dan aplikasi kembali stabil.

```bash
sudo kubectl create -f tests/load-test.json
# Setelah Load Test selesai dan kondisi lab stabil
sudo kubectl create -f tests/stress-test.json
```

Gunakan nama Job dari output perintah untuk mengecek status dan log.

```bash
sudo kubectl -n k6-lab get job NAMA_JOB
sudo kubectl -n k6-lab logs job/NAMA_JOB
```

Di Grafana, pilih nama pod sebagai `testid`. Pantau RPS, P95, error, dan resource aplikasi serta k6. Metrik mentah dan ringkasan JSON disimpan di PVC `k6-results`. Gunakan sampel per tahap untuk menilai hasil Stress Test karena P95 dan error pada dashboard bersifat kumulatif.

SQLite membuat database dan kunci JWT sendiri saat pertama kali dipakai. Jika perlu, isi `JWT_SECRET` dari pengelola secret environment. Simpan database, kredensial, dan hasil pengujian di luar Git.
