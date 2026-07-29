-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "mobileVerifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Contract" ADD COLUMN "billPushToTenant" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Contract" ADD COLUMN "billPushStatus" TEXT NOT NULL DEFAULT 'NOT_ENABLED';

-- AlterTable
ALTER TABLE "Bill" ADD COLUMN "tenantPushStatus" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "Bill" ADD COLUMN "pushedToTenantAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Tenant_idNumber_idx" ON "Tenant"("idNumber");
