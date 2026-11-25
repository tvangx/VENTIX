#!/usr/bin/env bash
set -Eeuo pipefail
# Usage: bash infra/deploy/demo.sh check|upgrade|rollback|infra-only INFRA_ENV APP_ENV TOKEN_FILE
# Server needs Docker Compose, bash and sha256sum only; no Git/Node/source checkout.
action=${1:?check|upgrade|rollback|infra-only}
infra_env=${2:?absolute infra env path}
app_env=${3:?absolute demo env path}
token_file=${4:?absolute connector token path}
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$root"
for file in "$infra_env" "$app_env" "$token_file"; do
  [[ "$file" = /* && -f "$file" ]] || { echo 'Expected existing absolute external env/token files' >&2; exit 1; }
done
[[ -f SHA256SUMS && -f release.env && -f IMAGES ]] || { echo 'Run from an extracted release artifact' >&2; exit 1; }
sha256sum --check --quiet SHA256SUMS
export CLOUDFLARED_TOKEN_FILE="$token_file"
base=(docker compose -p ticketing-prod --env-file "$infra_env" --env-file "$app_env" --env-file "$root/release.env" -f "$root/infra/compose/docker-compose.prod.yml" -f "$root/infra/compose/docker-compose.tunnel.yml")
app=("${base[@]}" -f "$root/infra/compose/docker-compose.apps.yml")
services=(identity event booking payment ticket web)
jobs=(identity-migrate event-migrate booking-migrate payment-migrate ticket-migrate)
case "$action" in check|upgrade|rollback|infra-only) ;; *) echo 'Unknown action' >&2; exit 1 ;; esac
"${app[@]}" config --quiet
if [[ "$action" = infra-only ]]; then
  "${app[@]}" stop "${services[@]}"
  "${base[@]}" up -d --no-deps --pull never --force-recreate kong
  echo 'Infrastructure gateway restored; app containers stopped; data/connector retained.'
  exit
fi
docker load -i images.tar
while read -r tag expected platform; do
  actual=$(docker image inspect "$tag" --format '{{.Id}} {{.Os}}/{{.Architecture}}')
  [[ "$actual" = "$expected $platform" && "$platform" = linux/amd64 ]] || { echo "Image mismatch: $tag" >&2; exit 1; }
done < IMAGES
# Preflight existing infra; do not recreate it or modify its credentials/networks/volumes.
for svc in postgres postgres-booking postgres-payment postgres-ticket redis kafka kong cloudflared; do
  id=$("${base[@]}" ps -q "$svc")
  [[ -n "$id" ]] || { echo "Required existing infrastructure missing: $svc" >&2; exit 1; }
  [[ "$(docker inspect "$id" --format '{{.State.Status}}')" = running ]] || { echo "Infrastructure not running: $svc" >&2; exit 1; }
done
for svc in identity event booking payment ticket; do
  "${app[@]}" run -T --interactive=false --rm --no-deps "$svc" validate < /dev/null
done
[[ "$action" != check ]] || { echo 'Artifact/images/env validated; no migrations or daemon changes.'; exit; }
if [[ "$action" = upgrade ]]; then
  # Reuse T-207's idempotent job: a healthy broker alone does not prove topics exist.
  "${app[@]}" run -T --interactive=false --rm --no-deps --pull never kafka-init < /dev/null
  # Sequential migration jobs make the failing service explicit; never reset or seed.
  for job in "${jobs[@]}"; do
    echo "Migrating $job"
    "${app[@]}" run -T --interactive=false --rm --no-deps "$job" < /dev/null || { echo "Migration failed: $job. Gateway unchanged; stop and inspect before retry." >&2; exit 1; }
  done
fi
# Rollback intentionally skips migration. Only use a previously proven compatible release.
"${app[@]}" up -d --no-deps --pull never --wait --wait-timeout 240 "${services[@]}"
"${app[@]}" up -d --no-deps --pull never --force-recreate --wait --wait-timeout 120 kong
curl --fail --silent --show-error --max-time 15 http://127.0.0.1:8000/health/infra
curl --fail --silent --show-error --max-time 15 http://127.0.0.1:8000/ > /dev/null
for svc in identity event booking payment ticket; do
  curl --fail --silent --show-error --max-time 15 "http://127.0.0.1:8000/api/$svc/health/ready"
done
echo 'Local gateway checks passed. Tuấn must verify public HTTPS and sandbox flow separately.'
