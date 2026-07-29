-- AlterTable
ALTER TABLE "BillOfflineVerifyLog" ADD COLUMN "collectionChannel" TEXT;
ALTER TABLE "BillOfflineVerifyLog" ADD COLUMN "collectionDate" TIMESTAMP(3);
ALTER TABLE "BillOfflineVerifyLog" ADD COLUMN "assetName" TEXT;
