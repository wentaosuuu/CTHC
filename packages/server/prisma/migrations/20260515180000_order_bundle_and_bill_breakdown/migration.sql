-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "houseId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leaseMonths" INTEGER NOT NULL,
    "moveInDate" DATETIME NOT NULL,
    "isMergedBundle" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,
    "reviewReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Order_houseId_fkey" FOREIGN KEY ("houseId") REFERENCES "House" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Order" ("id", "houseId", "tenantId", "leaseMonths", "moveInDate", "isMergedBundle", "status", "reviewReason", "createdAt", "updatedAt")
SELECT "id", "houseId", "tenantId", "leaseMonths", "moveInDate", false, "status", "reviewReason", "createdAt", "updatedAt" FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
CREATE INDEX IF NOT EXISTS "Order_houseId_idx" ON "Order"("houseId");
CREATE INDEX IF NOT EXISTS "Order_tenantId_idx" ON "Order"("tenantId");

CREATE TABLE "OrderLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "houseId" TEXT NOT NULL,
    "rentMonthlySnapshot" INTEGER NOT NULL,
    "depositSnapshot" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrderLine_houseId_fkey" FOREIGN KEY ("houseId") REFERENCES "House" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "OrderLine_orderId_idx" ON "OrderLine"("orderId");

CREATE TABLE "new_BillItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "billId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "breakdownJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BillItem_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_BillItem" ("id", "billId", "name", "amount", "breakdownJson", "createdAt")
SELECT "id", "billId", "name", "amount", NULL, "createdAt" FROM "BillItem";
DROP TABLE "BillItem";
ALTER TABLE "new_BillItem" RENAME TO "BillItem";
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
