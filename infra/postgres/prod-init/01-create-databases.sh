#!/usr/bin/env bash
# Chỉ chạy trên volume prod mới, không sửa quyền/database trên máy dev.
set -euo pipefail

: "${POSTGRES_USER:?Set POSTGRES_USER}"
: "${SERVICE_DATABASES:?Set SERVICE_DATABASES}"

for name in $SERVICE_DATABASES; do
  case "$name" in
    identity|event|booking|payment|ticket|resale|merch|notification|finance|ai) ;;
    *) printf 'Unknown service database: %s\n' "$name" >&2; exit 1 ;;
  esac
  password_var="DB_PASSWORD_${name^^}"
  password="${!password_var:-}"
  if [[ -z "$password" ]]; then
    printf 'Missing required secret: %s\n' "$password_var" >&2
    exit 1
  fi

  # psql quote literal + format(%I/%L) cho phép password có dấu nháy, không ghép SQL thô.
  psql -X --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
    --set=role="${name}_user" --set=database="${name}_db" --set=password="$password" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'role', :'password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'role')\gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'database', :'role')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'database')\gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'database')\gexec
SELECT format('GRANT ALL ON DATABASE %I TO %I', :'database', :'role')\gexec
SQL
  printf 'Initialized %s_db for %s_user\n' "$name" "$name"
done
