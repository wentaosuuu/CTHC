-- AlterTable
ALTER TABLE "Contract" ADD COLUMN "contractTemplate" TEXT NOT NULL DEFAULT 'APARTMENT';
ALTER TABLE "Contract" ADD COLUMN "terminationRentMultiple" REAL;
ALTER TABLE "Contract" ADD COLUMN "terminationDaysPastDue" INTEGER;
