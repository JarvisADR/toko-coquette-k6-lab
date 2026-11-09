#!/usr/bin/env bash
set -euo pipefail

# Run with sudo by an existing VM operator after verifying the GitHub release.
[[ $# -eq 3 && ${2:-} =~ ^[0-9a-f]{40}$ && ${3:-} =~ ^[0-9a-f]{64}$ ]] ||
  { echo 'Usage: k3s-deploy.sh <archive> <commit> <archive-sha256>' >&2; exit 1; }
archive=$(realpath -e -- "$1")
commit=$2
digest=$3
[[ -f $archive ]] || { echo 'Image archive is missing' >&2; exit 1; }

base=/var/lib/coquette-cd
install -d -m 0700 -o root -g root "$base"
work=$(mktemp -d "$base/staging-XXXXXXXX")
trap 'rm -f -- "$work/sqlite.db" "$work/sqlite.db-wal" "$work/sqlite.db-shm"; rmdir -- "$work"' EXIT
exec 9>"$base/deploy.lock"
flock -n 9 || { echo 'A deployment is already running' >&2; exit 1; }
(( $(df -Pm "$base" | awk 'NR==2 {print $4}') >= 2500 )) ||
  { echo 'Deployment requires 2.5 GB of free disk space' >&2; exit 1; }

k=(/usr/local/bin/k3s kubectl -n k6-lab)
backend="coquette-ci.invalid/toko-backend:$commit"
frontend="coquette-ci.invalid/toko-frontend:$commit"
limit=$((384 * 1024 * 1024))
[[ $(stat -c %s "$archive") -le $limit ]] || { echo 'Image bundle is too large' >&2; exit 1; }
printf '%s  %s\n' "$digest" "$archive" | sha256sum --check --status

check_no_running_test() {
  "${k[@]}" get jobs -o json | python3 -c '
import json, sys
jobs = json.load(sys.stdin)["items"]
if any(job.get("status", {}).get("active", 0) for job in jobs):
    sys.exit("A k6 job is active. Deploy after the test ends.")
'
}
check_no_running_test
old_backend=$("${k[@]}" get deploy ecommerce-backend -o 'jsonpath={.spec.template.spec.containers[?(@.name=="ecommerce-backend")].image}')
old_frontend=$("${k[@]}" get deploy ecommerce-frontend -o 'jsonpath={.spec.template.spec.containers[?(@.name=="ecommerce-frontend")].image}')
[[ -n $old_backend && -n $old_frontend ]]
if [[ $old_backend == "$backend" && $old_frontend == "$frontend" ]]; then
  curl -fsS --max-time 8 -o /dev/null http://127.0.0.1:8080/api/products
  echo 'Commit is already deployed and responding'
  exit 0
fi

gzip -dc -- "$archive" | timeout 240 /usr/local/bin/k3s ctr --namespace k8s.io images import --platform linux/amd64 - >/dev/null
/usr/local/bin/k3s crictl inspecti "$backend" >/dev/null
/usr/local/bin/k3s crictl inspecti "$frontend" >/dev/null

# SQLite's backup API includes committed WAL changes without copying live sidecars.
db_dir=$("${k[@]}" get pv petite-bow-sqlite -o 'jsonpath={.spec.local.path}')
[[ -n $db_dir && -s "$db_dir/toko.db" ]]
timeout 30 python3 - "$db_dir/toko.db" "$work/sqlite.db" <<'PY'
import sqlite3
import sys
from pathlib import Path

source = Path(sys.argv[1]).resolve().as_uri() + '?mode=ro'
with sqlite3.connect(source, uri=True) as live, sqlite3.connect(sys.argv[2]) as backup:
    live.backup(backup)
    if backup.execute('PRAGMA quick_check').fetchone() != ('ok',):
        raise SystemExit('SQLite backup integrity check failed')
PY
chmod 0600 "$work/sqlite.db"
mv -fT -- "$work/sqlite.db" "$base/before-deploy.db"

check_no_running_test
rollout() {
  "${k[@]}" set image deployment/ecommerce-backend "ecommerce-backend=$1" &&
  "${k[@]}" rollout status deployment/ecommerce-backend --timeout=100s &&
  "${k[@]}" set image deployment/ecommerce-frontend "ecommerce-frontend=$2" &&
  "${k[@]}" rollout status deployment/ecommerce-frontend --timeout=100s
}
verify_http() {
  curl -fsS --retry 6 --retry-all-errors --retry-delay 2 --max-time 5 \
    -o /dev/null http://127.0.0.1:8080/ &&
  curl -fsS --retry 6 --retry-all-errors --retry-delay 2 --max-time 5 \
    http://127.0.0.1:8080/api/products | python3 -c '
import json, sys
products = json.load(sys.stdin)
assert isinstance(products, list) and products
'
}
if rollout "$backend" "$frontend" && verify_http; then
  printf 'Deployment verified for %s\n' "$commit"
else
  echo 'Deployment failed. Restoring previous application images.' >&2
  rollout "$old_backend" "$old_frontend" && verify_http ||
    echo 'Rollback verification failed. Check the two Deployments.' >&2
  exit 1
fi
