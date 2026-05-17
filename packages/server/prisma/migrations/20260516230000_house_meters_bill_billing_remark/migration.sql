-- AlterTable
ALTER TABLE "House" ADD COLUMN "waterMeterNosJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "House" ADD COLUMN "electricMeterNosJson" TEXT NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "Bill" ADD COLUMN "billingRemark" TEXT;
