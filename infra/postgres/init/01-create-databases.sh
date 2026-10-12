#!/bin/bash
# Chạy 1 lần khi volume Postgres còn trống.
# Mỗi service có: 1 DATABASE <name>_db + 1 ROLE <name>_user, chỉ role đó được connect.
set -euo pipefail

create_service_db() {
  local name="$1"
  local var="DB_PASSWORD_$(echo "$name" | tr '[:lower:]' '[:upper:]')"
  local pass="${!var:-${name}_dev}"

  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<EOSQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${name}_user') THEN
    CREATE ROLE ${name}_user LOGIN PASSWORD '${pass}';
  END IF;
END
\$\$;
SELECT 'CREATE DATABASE ${name}_db OWNER ${name}_user'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${name}_db')\gexec
REVOKE ALL ON DATABASE ${name}_db FROM PUBLIC;
GRANT ALL ON DATABASE ${name}_db TO ${name}_user;
EOSQL
  echo "created ${name}_db / ${name}_user"
}

for svc in identity event booking payment ticket resale merch notification finance ai; do
  create_service_db "$svc"
done
