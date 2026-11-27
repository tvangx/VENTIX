-- Run once by the infrastructure administrator per PostgreSQL cluster, before starting postgres-exporter.
-- Replace the password through a protected prompt/runbook; never commit it or use infra_admin at runtime.
CREATE ROLE ticketing_monitor LOGIN PASSWORD :'monitor_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
GRANT pg_monitor TO ticketing_monitor;
GRANT CONNECT ON DATABASE identity_db, event_db, booking_db, payment_db, ticket_db, resale_db, finance_db TO ticketing_monitor;
-- Deliberately no USAGE/SELECT on service schemas/tables: exporter observes connections and server stats only.
