-- 合并订单子资产退租/换房释放：已释放行不再计入后续账单
ALTER TABLE "OrderLine" ADD COLUMN "releasedAt" DATETIME;
