-- CreateTable
CREATE TABLE "HouseChangeLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "houseId" TEXT NOT NULL,
    "fieldLabel" TEXT NOT NULL,
    "beforeValue" TEXT NOT NULL DEFAULT '',
    "afterValue" TEXT NOT NULL DEFAULT '',
    "changedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "adminId" TEXT,
    "adminName" TEXT,
    "adminEmail" TEXT,
    CONSTRAINT "HouseChangeLog_houseId_fkey" FOREIGN KEY ("houseId") REFERENCES "House" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HouseChangeLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "HouseChangeLog_houseId_idx" ON "HouseChangeLog"("houseId");

-- CreateIndex
CREATE INDEX "HouseChangeLog_changedAt_idx" ON "HouseChangeLog"("changedAt");
