-- GAVEL migration 0002 — Row-Level Security tenant isolation (WP 1.1).
--
-- Defense-in-depth behind the application-layer scoping (Prisma client
-- extension in src/lib/db.ts): even if a query bypasses the WHERE-tenantId
-- injection, PostgreSQL itself refuses to return or modify rows whose
-- tenantId does not match the session's app.current_tenant_id.
--
-- Connection contract:
--   * The server connects as gavel_app (owns nothing → RLS fully applies).
--   * src/lib/db.ts opens every scoped operation inside a transaction whose
--     FIRST statement is `SELECT set_config('app.current_tenant_id', …, true)`
--     — transaction-local, pool-safe (SET LOCAL semantics).
--   * gavel_owner (migrations, system CLI) owns the tables and therefore
--     bypasses RLS — the deliberate trusted path for DDL and cross-tenant
--     maintenance.
--
-- Scope: the 20 tenant-data models (the SCOPED_MODELS set in src/lib/db.ts).
-- Platform tables are deliberately excluded and remain guarded by route-level
-- role checks:
--   Tenant          — cross-tenant by definition (the isolation boundary itself)
--   User            — login must resolve users before any tenant is known
--   RateLimitCounter — keyed by IP/identity, no tenant dimension
--   PurposeToken    — random 32-byte tokens, role-gated routes
--
-- Prerequisites: gavel_owner + gavel_app roles exist (scripts/pg/init-roles.sql,
-- docker-compose first boot, or docs/DEPLOYMENT.md §Roles for managed PG).

-- ── 1. Enable RLS on every tenant table ────────────────────────────────────

ALTER TABLE "Alert"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChangeOrder"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Client"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CodeActivity"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConnectorSource"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Contract"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Exclusion"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Finding"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FindingEvidence"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invoice"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InvoiceLine"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LineItem"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Milestone"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MonitoredProject" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payment"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Project"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Ticket"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TimeEntry"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WeeklyDriftSnapshot" ENABLE ROW LEVEL SECURITY;

-- ── 2. Isolation policy per table ──────────────────────────────────────────
-- current_setting(..., true) returns NULL when the GUC is unset → the
-- comparison is NULL → policy fails → ZERO rows. Fail-closed by construction.
-- WITH CHECK additionally rejects INSERT/UPDATE of rows whose tenantId
-- doesn't match the session tenant (cross-tenant writes raise 42501).

CREATE POLICY tenant_isolation ON "Alert"            FOR ALL TO gavel_app USING ("tenantId" = current_setting('app.current_tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));
CREATE POLICY tenant_isolation ON "AuditLog"         FOR ALL TO gavel_app USING ("tenantId" = current_setting('app.current_tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));
CREATE POLICY tenant_isolation ON "ChangeOrder"      FOR ALL TO gavel_app USING ("tenantId" = current_setting('app.current_tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));
CREATE POLICY tenant_isolation ON "Client"           FOR ALL TO gavel_app USING ("tenantId" = current_setting('app.current_tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));
CREATE POLICY tenant_isolation ON "CodeActivity"     FOR ALL TO gavel_app USING ("tenantId" = current_setting('app.current_tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));
CREATE POLICY tenant_isolation ON "ConnectorSource"  FOR ALL TO gavel_app USING ("tenantId" = current_setting('app.current_tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));
CREATE POLICY tenant_isolation ON "Contract"         FOR ALL TO gavel_app USING ("tenantId" = current_setting('app.current_tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));
CREATE POLICY tenant_isolation ON "Exclusion"        FOR ALL TO gavel_app USING ("tenantId" = current_setting('app.current_tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));
CREATE POLICY tenant_isolation ON "Finding"          FOR ALL TO gavel_app USING ("tenantId" = current_setting('app.current_tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));
CREATE POLICY tenant_isolation ON "FindingEvidence"  FOR ALL TO gavel_app USING ("tenantId" = current_setting('app.current_tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));
CREATE POLICY tenant_isolation ON "Invoice"          FOR ALL TO gavel_app USING ("tenantId" = current_setting('app.current_tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));
CREATE POLICY tenant_isolation ON "InvoiceLine"      FOR ALL TO gavel_app USING ("tenantId" = current_setting('app.current_tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));
CREATE POLICY tenant_isolation ON "LineItem"         FOR ALL TO gavel_app USING ("tenantId" = current_setting('app.current_tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));
CREATE POLICY tenant_isolation ON "Milestone"        FOR ALL TO gavel_app USING ("tenantId" = current_setting('app.current_tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));
CREATE POLICY tenant_isolation ON "MonitoredProject" FOR ALL TO gavel_app USING ("tenantId" = current_setting('app.current_tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));
CREATE POLICY tenant_isolation ON "Payment"          FOR ALL TO gavel_app USING ("tenantId" = current_setting('app.current_tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));
CREATE POLICY tenant_isolation ON "Project"          FOR ALL TO gavel_app USING ("tenantId" = current_setting('app.current_tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));
CREATE POLICY tenant_isolation ON "Ticket"           FOR ALL TO gavel_app USING ("tenantId" = current_setting('app.current_tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));
CREATE POLICY tenant_isolation ON "TimeEntry"        FOR ALL TO gavel_app USING ("tenantId" = current_setting('app.current_tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));
CREATE POLICY tenant_isolation ON "WeeklyDriftSnapshot" FOR ALL TO gavel_app USING ("tenantId" = current_setting('app.current_tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));

-- ── 3. Runtime grants for gavel_app ────────────────────────────────────────
-- DML only. No TRUNCATE, no REFERENCES, no CREATE. Future tables created by
-- later migrations must repeat the grant (guarded by scripts/verify-db-parity.ts).

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gavel_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gavel_app;

-- Tables made from now on (by gavel_owner migrations) inherit the grants.
ALTER DEFAULT PRIVILEGES FOR ROLE gavel_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gavel_app;
ALTER DEFAULT PRIVILEGES FOR ROLE gavel_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO gavel_app;

-- The app role may read migration bookkeeping (health ?deep=1 reports it).
-- Guarded: prisma migrate diff replays migration SQL into shadow databases
-- WITHOUT creating _prisma_migrations first, and an unguarded GRANT would
-- abort the replay (P1014). Real deploys (migrate deploy) always have the
-- table by the time this runs.
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = '_prisma_migrations') THEN
    GRANT SELECT ON TABLE "_prisma_migrations" TO gavel_app;
  END IF;
END
$$;
