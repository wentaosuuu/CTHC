-- SQLite 3.35+: 移除「下单外链」列（直接下单走本系统）
ALTER TABLE "House" DROP COLUMN "externalOrderUrl";
