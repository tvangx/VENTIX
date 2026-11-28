#!/usr/bin/env bash
set -Eeuo pipefail
# Usage: bash infra/obs/obs.sh check|start|stop|rollback ABSOLUTE_OBS_ENV [project]
# Standalone additive artifact: never loads app env, migrates or recreates app containers.
action=${1:?check|start|stop|rollback}
obs_env=${2:?absolute external obs env path}
project=${3:-ticketing-prod}
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$root"
case "$action" in check|start|stop|rollback) ;; *) echo 'Unknown obs action' >&2; exit 1 ;; esac
[[ "$project" =~ ^[a-z0-9][a-z0-9_-]*$ && "$obs_env" = /* && -f "$obs_env" ]] || { echo 'Invalid project or absolute env path' >&2; exit 1; }
# Parse only this dedicated strict schema; never source an env file or print values.
fields=(PROMETHEUS_IMAGE GRAFANA_IMAGE ALLOY_IMAGE LOKI_IMAGE JAEGER_IMAGE KAFKA_EXPORTER_IMAGE REDIS_EXPORTER_IMAGE POSTGRES_EXPORTER_IMAGE OBS_NETWORK PROMETHEUS_PORT GRAFANA_PORT JAEGER_PORT ALLOY_OTLP_HTTP_PORT LOKI_PORT APP_LOG_DIR POSTGRES_MONITOR_PASSWORD_SHARED POSTGRES_MONITOR_PASSWORD_BOOKING POSTGRES_MONITOR_PASSWORD_PAYMENT POSTGRES_MONITOR_PASSWORD_TICKET GRAFANA_ADMIN_USER GRAFANA_ADMIN_PASSWORD)
pg_monitor_fields=(POSTGRES_MONITOR_PASSWORD_SHARED POSTGRES_MONITOR_PASSWORD_BOOKING POSTGRES_MONITOR_PASSWORD_PAYMENT POSTGRES_MONITOR_PASSWORD_TICKET)
# One exporter per independent PostgreSQL cluster (shared, booking, payment, ticket).
obs_services=(prometheus grafana loki jaeger alloy kafka-exporter redis-exporter postgres-exporter-shared postgres-exporter-booking postgres-exporter-payment postgres-exporter-ticket)
for key in "${fields[@]}"; do unset "$key"; done
declare -A seen=()
while IFS= read -r line || [[ -n "$line" ]]; do
  line=${line%$'\r'}
  [[ -z "$line" || "$line" = \#* ]] && continue
  [[ "$line" = *=* ]] || { echo 'Invalid obs env syntax' >&2; exit 1; }
  key=${line%%=*}; value=${line#*=}
  case "$key" in
    PROMETHEUS_IMAGE|GRAFANA_IMAGE|ALLOY_IMAGE|LOKI_IMAGE|JAEGER_IMAGE|KAFKA_EXPORTER_IMAGE|REDIS_EXPORTER_IMAGE|POSTGRES_EXPORTER_IMAGE|OBS_NETWORK|PROMETHEUS_PORT|GRAFANA_PORT|JAEGER_PORT|ALLOY_OTLP_HTTP_PORT|LOKI_PORT|APP_LOG_DIR|POSTGRES_MONITOR_PASSWORD_SHARED|POSTGRES_MONITOR_PASSWORD_BOOKING|POSTGRES_MONITOR_PASSWORD_PAYMENT|POSTGRES_MONITOR_PASSWORD_TICKET|GRAFANA_ADMIN_USER|GRAFANA_ADMIN_PASSWORD) ;;
    POSTGRES_EXPORTER_DSN) echo 'POSTGRES_EXPORTER_DSN was replaced by POSTGRES_MONITOR_PASSWORD_{SHARED,BOOKING,PAYMENT,TICKET}; see docs/ops/observability.md' >&2; exit 1 ;;
    *) echo 'Unknown obs env field' >&2; exit 1 ;;
  esac
  [[ -z "${seen[$key]:-}" ]] || { echo "Duplicate field: $key" >&2; exit 1; }
  seen[$key]=1
  printf -v "$key" '%s' "$value"
  export "$key"
done < "$obs_env"
for key in "${fields[@]}"; do
  [[ -n "${!key:-}" ]] || { echo "Missing field: $key" >&2; exit 1; }
done
[[ "$PROMETHEUS_IMAGE" =~ ^prom/prometheus:v[0-9]+\.[0-9]+\.[0-9]+@sha256:[a-f0-9]{64}$ ]] || { echo 'Invalid PROMETHEUS_IMAGE' >&2; exit 1; }
[[ "$GRAFANA_IMAGE" =~ ^grafana/grafana:[0-9]+\.[0-9]+\.[0-9]+@sha256:[a-f0-9]{64}$ ]] || { echo 'Invalid GRAFANA_IMAGE' >&2; exit 1; }
for key in ALLOY_IMAGE LOKI_IMAGE JAEGER_IMAGE KAFKA_EXPORTER_IMAGE REDIS_EXPORTER_IMAGE POSTGRES_EXPORTER_IMAGE; do
  [[ "${!key}" =~ ^[^[:space:]@]+:[^[:space:]@]+@sha256:[a-f0-9]{64}$ ]] || { echo "Invalid $key" >&2; exit 1; }
done
[[ "$OBS_NETWORK" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$ ]] || { echo 'Invalid OBS_NETWORK' >&2; exit 1; }
[[ "$GRAFANA_ADMIN_USER" =~ ^[a-zA-Z][a-zA-Z0-9_-]{2,31}$ ]] || { echo 'Invalid GRAFANA_ADMIN_USER' >&2; exit 1; }
[[ "$GRAFANA_ADMIN_PASSWORD" =~ ^[a-zA-Z0-9_-]{24,128}$ ]] || { echo 'Invalid GRAFANA_ADMIN_PASSWORD (24-128 alphanumeric/underscore/hyphen characters)' >&2; exit 1; }
for key in PROMETHEUS_PORT GRAFANA_PORT JAEGER_PORT ALLOY_OTLP_HTTP_PORT LOKI_PORT; do
  [[ "${!key}" =~ ^[1-9][0-9]{0,4}$ ]] && (( ${!key} >= 1024 && ${!key} <= 65535 )) || { echo "Invalid $key" >&2; exit 1; }
done
declare -A port_seen=()
for key in PROMETHEUS_PORT GRAFANA_PORT JAEGER_PORT ALLOY_OTLP_HTTP_PORT LOKI_PORT; do
  [[ -z "${port_seen[${!key}]:-}" ]] || { echo 'Obs ports must differ' >&2; exit 1; }
  port_seen[${!key}]=1
done
declare -A pg_password_seen=()
for key in "${pg_monitor_fields[@]}"; do
  [[ "${!key}" =~ ^[a-zA-Z0-9_-]{24,128}$ ]] || { echo "Invalid $key (24-128 alphanumeric/underscore/hyphen characters)" >&2; exit 1; }
  [[ -z "${pg_password_seen[${!key}]:-}" ]] || { echo 'POSTGRES_MONITOR_PASSWORD_* must differ per cluster' >&2; exit 1; }
  pg_password_seen[${!key}]=1
done
[[ -d "$APP_LOG_DIR" ]] || { echo 'APP_LOG_DIR must be an existing host directory' >&2; exit 1; }
compose_root=$root; compose_env=$obs_env
if [[ "${OSTYPE:-}" = msys* || "${OSTYPE:-}" = cygwin* ]]; then
  compose_root=$(cygpath -m "$root"); compose_env=$(cygpath -m "$obs_env")
  export MSYS_NO_PATHCONV=1
fi
compose=(docker compose -p "$project" --env-file "$compose_env" -f "$compose_root/infra/compose/docker-compose.obs.yml")
"${compose[@]}" config --quiet
if [[ "$action" = stop ]]; then
  "${compose[@]}" stop "${obs_services[@]}"
  echo 'Only observability stopped; application and all volumes retained.'
  exit
fi
if [[ -f OBS_SHA256SUMS ]]; then
  sha256sum --check --quiet OBS_SHA256SUMS
  docker load -i obs-images.tar
  while read -r field tag expected platform pinned; do
    case "$field" in PROMETHEUS_IMAGE|GRAFANA_IMAGE|ALLOY_IMAGE|LOKI_IMAGE|JAEGER_IMAGE|KAFKA_EXPORTER_IMAGE|REDIS_EXPORTER_IMAGE|POSTGRES_EXPORTER_IMAGE) ;; *) echo 'Invalid obs image field' >&2; exit 1 ;; esac
    [[ "${!field}" = "$pinned" ]] || { echo 'Env image differs from selected artifact' >&2; exit 1; }
    actual=$(docker image inspect "$tag" --format '{{.Id}} {{.Os}}/{{.Architecture}}')
    [[ "$actual" = "$expected $platform" && "$platform" = linux/amd64 ]] || { echo 'Obs image manifest mismatch' >&2; exit 1; }
    # docker save/load may not retain RepoDigests; use the manifest-verified local tag.
    printf -v "$field" '%s' "$tag"
    export "$field"
  done < OBS_IMAGES
fi
for image in "$PROMETHEUS_IMAGE" "$GRAFANA_IMAGE" "$ALLOY_IMAGE" "$LOKI_IMAGE" "$JAEGER_IMAGE" "$KAFKA_EXPORTER_IMAGE" "$REDIS_EXPORTER_IMAGE" "$POSTGRES_EXPORTER_IMAGE"; do
  [[ "$(docker image inspect "$image" --format '{{.Os}}/{{.Architecture}}')" = linux/amd64 ]] || { echo 'Load the pinned amd64 images before starting' >&2; exit 1; }
done
docker network inspect "$OBS_NETWORK" > /dev/null
"${compose[@]}" run -T --rm --no-deps --pull never --entrypoint /bin/promtool prometheus check config /etc/prometheus/prometheus.yml
[[ "$action" != check ]] || { echo 'Obs config/images/network checked; app unchanged.'; exit; }
# Both start/rollback use the selected obs artifact. Keep SQLite and TSDB volumes.
"${compose[@]}" up -d --pull never --force-recreate "${obs_services[@]}"
for port_path in "$PROMETHEUS_PORT/-/ready" "$GRAFANA_PORT/api/health" "$LOKI_PORT/ready" "$JAEGER_PORT/"; do
  ready=false
  for ((attempt=0; attempt<180; attempt++)); do
    if curl --fail --silent --max-time 2 "http://127.0.0.1:$port_path" > /dev/null; then ready=true; break; fi
    sleep 1
  done
  [[ "$ready" = true ]] || { echo 'Obs readiness failed; inspect obs logs; app unchanged' >&2; exit 1; }
done
echo 'Observability ready on loopback. Verify scrape targets and RED separately.'
