-- AlterTable
ALTER TABLE "Contract" ADD COLUMN "tenantSignDeadlineAt" TIMESTAMP(3);

-- 已有「待租客签字」合同：按创建时间补 3 天截止（SQLite）
UPDATE "Contract"
SET "tenantSignDeadlineAt" = datetime("createdAt", '+3 days')
WHERE "status" = 'WAIT_TENANT_SIGN' AND "tenantSignDeadlineAt" IS NULL;
