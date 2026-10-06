-- GAVEL — PostgreSQL role provisioning (WP 1.1).
--
-- Executed by docker-compose (mounted as
-- /docker-entrypoint-initdb.d/01-roles.sql) on FIRST boot of the data
-- volume, and by scripts/pg-embedded.ts for no-Docker environments, and
-- by hand on managed providers (see docs/DEPLOYMENT.md §Roles).
--
-- Two-role design — the foundation of database-level tenant isolation:
--
--   gavel_owner  : owns the schema and tables. Used ONLY for migrations
--                  (prisma migrate deploy) and system/CLI maintenance.
--                  Table owners bypass RLS, so this role is the
--                  deliberately-trusted path for DDL + cross-tenant ops.
--
--   gavel_app    : the RUNTIME role the Next.js server connects as.
--                  Holds DML grants (SELECT/INSERT/UPDATE/DELETE) but owns
--                  nothing — therefore fully subject to the RLS policies
--                  created in migration 0002_rls_tenant_isolation. If the
--                  application layer fails to set app.current_tenant_id,
--                  this role sees ZERO rows from every tenant table.
--                  Fail-closed at the database itself.
--
-- Idempotent: uses DO blocks so re-running on an existing cluster is safe.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'gavel_owner') THEN
    CREATE ROLE gavel_owner LOGIN PASSWORD 'change-me-owner';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'gavel_app') THEN
    CREATE ROLE gavel_app LOGIN PASSWORD 'change-me-app';
  END IF;
END
$$;

-- Both roles can use the database and schema.
GRANT CONNECT ON DATABASE gavel TO gavel_owner, gavel_app;
GRANT USAGE ON SCHEMA public TO gavel_owner, gavel_app;

-- The owner runs migrations — 0001_init issues `CREATE SCHEMA IF NOT EXISTS
-- "public"`, which needs database-level CREATE (not just schema-level).
GRANT CREATE ON DATABASE gavel TO gavel_owner;
GRANT CREATE ON SCHEMA public TO gavel_owner;
