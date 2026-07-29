-- CreateEnum-like defaults for SQLite (stored as TEXT)
ALTER TABLE "Tenant" ADD COLUMN "tenantKind" TEXT NOT NULL DEFAULT 'INDIVIDUAL';
ALTER TABLE "Tenant" ADD COLUMN "createdSource" TEXT NOT NULL DEFAULT 'MOBILE_SELF';
ALTER TABLE "Tenant" ADD COLUMN "createdByAdminId" TEXT;

UPDATE "Tenant" SET "tenantKind" = 'ENTERPRISE' WHERE "idDocType" = 'USCC';

CREATE INDEX "Tenant_createdByAdminId_idx" ON "Tenant"("createdByAdminId");
