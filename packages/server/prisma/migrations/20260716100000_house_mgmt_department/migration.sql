-- AlterTable
ALTER TABLE "House" ADD COLUMN "mgmtDepartment" TEXT DEFAULT '公寓管理部';

-- Backfill existing rows
UPDATE "House" SET "mgmtDepartment" = '公寓管理部' WHERE "mgmtDepartment" IS NULL;
