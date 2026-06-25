-- 合并合同子资产换房：标记迁出并关联新合同，便于区分「已换」与退租迁出
ALTER TABLE "OrderLine" ADD COLUMN "changeHouseNewContractId" TEXT;

CREATE INDEX "OrderLine_changeHouseNewContractId_idx" ON "OrderLine"("changeHouseNewContractId");
