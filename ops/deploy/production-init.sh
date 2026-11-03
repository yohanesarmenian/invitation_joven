#!/bin/sh
set -eu
# Official image runs this only for a new, empty cluster. Never echo secrets.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv app_password APP_DATABASE_PASSWORD
\getenv migrator_password MIGRATOR_DATABASE_PASSWORD
SELECT format('CREATE ROLE invitation_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L', :'migrator_password') \gexec
SELECT format('CREATE ROLE invitation_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L', :'app_password') \gexec
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO invitation_migrator;
SELECT format('GRANT CONNECT ON DATABASE %I TO invitation_migrator, invitation_app', current_database()) \gexec
GRANT USAGE ON SCHEMA public TO invitation_app;
ALTER DEFAULT PRIVILEGES FOR ROLE invitation_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO invitation_app;
ALTER DEFAULT PRIVILEGES FOR ROLE invitation_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO invitation_app;
SQL
