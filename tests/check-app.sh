#!/usr/bin/env bash
set -euo pipefail

cleanup() {
  docker rm -f coquette-ci-frontend coquette-ci-backend >/dev/null 2>&1 || true
  docker network rm coquette-ci >/dev/null 2>&1 || true
}

docker network create coquette-ci >/dev/null
trap cleanup EXIT
# The frontend config resolves the Alloy hostname at startup. CI checks HTTP only.
docker run -d --name coquette-ci-backend --network coquette-ci \
  --network-alias backend --network-alias alloy coquette-backend:ci >/dev/null
docker run -d --name coquette-ci-frontend --network coquette-ci \
  -p 127.0.0.1::80 coquette-frontend:ci >/dev/null
base="http://$(docker port coquette-ci-frontend 80/tcp)"

curl -fsS --max-time 5 --retry 15 --retry-delay 1 --retry-all-errors "$base/" | grep -F '<title>Petite Bow'
curl -fsS --max-time 5 "$base/api/products" | jq -e 'type == "array" and length > 0' >/dev/null

# Register one throwaway user in the CI container's disposable SQLite database.
email=ci@example.test
password=$(openssl rand -hex 24)
body=$(jq -cn --arg email "$email" --arg password "$password" '{email:$email,password:$password}')
profile=$(jq -c '. + {name:"CI Tester",phone:"000000",address:"CI only"}' <<<"$body")
curl -fsS --max-time 5 -H 'Content-Type: application/json' \
  --data "$profile" "$base/api/auth/register" >/dev/null
token=$(curl -fsS --max-time 5 -H 'Content-Type: application/json' \
  --data "$body" "$base/api/auth/login" | jq -er '.token | select(type=="string" and length>0)')
curl -fsS --max-time 5 -H "Authorization: Bearer $token" "$base/api/auth/me" \
  | jq -e --arg email "$email" '.user.email == $email' >/dev/null
printf 'Homepage, catalog, login, and authenticated profile passed.\n'
