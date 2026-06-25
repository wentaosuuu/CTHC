-- 交租日：每个缴费周期起始月内的应交日（1-31）
ALTER TABLE "Contract" ADD COLUMN "rentDueDay" INTEGER NOT NULL DEFAULT 1;
