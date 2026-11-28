-- T-501: least-privilege role for postgres_exporter on ONE PostgreSQL 16 cluster.
-- Run the same file on each independent cluster (shared, booking, payment, ticket) as the
-- cluster admin, connected to database "postgres", with psql -X -v ON_ERROR_STOP=1.
-- Idempotent: creates the role if missing, otherwise normalises it in place (never DROP).
-- No password here: set it afterwards with psql's interactive `\password ticketing_monitor`.
-- Deliberately no USAGE/SELECT on service schemas/tables and no CONNECT to service *_db:
-- pg_monitor (pg_read_all_stats) already exposes cluster stats and pg_database_size().

DO $$
BEGIN
  IF current_setting('server_version_num')::int < 160000 THEN
    RAISE EXCEPTION 'PostgreSQL 16+ required (GRANT ... WITH INHERIT TRUE for a NOINHERIT role)';
  END IF;
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Connect to database postgres, not %', current_database();
  END IF;
END
$$;

BEGIN;
SELECT 'CREATE ROLE ticketing_monitor'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ticketing_monitor')\gexec
ALTER ROLE ticketing_monitor WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
  NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 3;
-- NOINHERIT is only the default for new grants since PostgreSQL 16; the exporter never runs
-- SET ROLE, so this one membership must inherit explicitly. SET FALSE forbids SET ROLE.
GRANT pg_monitor TO ticketing_monitor WITH INHERIT TRUE, SET FALSE;
REVOKE ADMIN OPTION FOR pg_monitor FROM ticketing_monitor;
GRANT CONNECT ON DATABASE postgres TO ticketing_monitor;
-- Remove any direct database grant left by an earlier attempt (privilege reduction only).
SELECT format('REVOKE ALL ON DATABASE %I FROM ticketing_monitor', datname)
FROM pg_database
WHERE NOT datistemplate AND datname <> 'postgres'
ORDER BY datname\gexec
COMMIT;

-- Verify; fails without changing anything else. Review/revoke manually, do not DROP.
DO $$
DECLARE
  monitor pg_roles%ROWTYPE;
  unexpected text;
BEGIN
  SELECT * INTO monitor FROM pg_roles WHERE rolname = 'ticketing_monitor';
  IF monitor.rolsuper OR monitor.rolcreatedb OR monitor.rolcreaterole OR monitor.rolinherit
     OR monitor.rolreplication OR monitor.rolbypassrls OR NOT monitor.rolcanlogin THEN
    RAISE EXCEPTION 'ticketing_monitor attributes are not least-privilege';
  END IF;
  SELECT string_agg(granted.rolname, ', ' ORDER BY granted.rolname) INTO unexpected
  FROM pg_auth_members m JOIN pg_roles granted ON granted.oid = m.roleid
  WHERE m.member = monitor.oid
    AND NOT (granted.rolname = 'pg_monitor' AND m.inherit_option AND NOT m.set_option
             AND NOT m.admin_option);
  IF unexpected IS NOT NULL THEN
    RAISE EXCEPTION 'Unexpected membership or grant options for ticketing_monitor: %', unexpected;
  END IF;
  IF NOT pg_has_role(monitor.oid, 'pg_read_all_stats', 'USAGE') THEN
    RAISE EXCEPTION 'ticketing_monitor does not inherit pg_monitor';
  END IF;
  SELECT string_agg(datname, ', ' ORDER BY datname) INTO unexpected
  FROM pg_database
  WHERE NOT datistemplate AND datname <> 'postgres'
    AND has_database_privilege(monitor.oid, oid, 'CONNECT');
  IF unexpected IS NOT NULL THEN
    RAISE EXCEPTION 'ticketing_monitor can still CONNECT (direct or PUBLIC) to: %', unexpected;
  END IF;
  RAISE NOTICE 'ticketing_monitor verified on this cluster; set/rotate password with \password';
END
$$;
