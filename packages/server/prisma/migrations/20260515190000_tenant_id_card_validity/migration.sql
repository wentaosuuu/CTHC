-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "idCardLongTerm" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tenant" ADD COLUMN "idCardValidUntil" TIMESTAMP(3);
