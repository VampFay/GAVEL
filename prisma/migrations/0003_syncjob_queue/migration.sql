-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "stats" TEXT,
    "requestedBy" TEXT NOT NULL,
    "requestId" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyncJob_tenantId_connectorId_createdAt_idx" ON "SyncJob"("tenantId", "connectorId", "createdAt");

-- CreateIndex
CREATE INDEX "SyncJob_status_idx" ON "SyncJob"("status");

-- AddForeignKey
ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "ConnectorSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── WP 1.2: SyncJob is tenant data — same RLS contract as every other
-- scoped model (migration 0002). Default privileges from 0002 already
-- grant gavel_app DML on tables created by gavel_owner migrations.

ALTER TABLE "SyncJob" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SyncJob" FOR ALL TO gavel_app
  USING ("tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));
