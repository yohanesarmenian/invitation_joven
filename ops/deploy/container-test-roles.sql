-- Public synthetic credentials. Mounted only by compose.verify.yaml.
CREATE ROLE invitation_migrator LOGIN PASSWORD 'container_fixture_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE invitation_app LOGIN PASSWORD 'container_fixture_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
ALTER DATABASE invitation_ci OWNER TO invitation_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO invitation_app;
ALTER DEFAULT PRIVILEGES FOR ROLE invitation_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO invitation_app;
ALTER DEFAULT PRIVILEGES FOR ROLE invitation_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO invitation_app;
