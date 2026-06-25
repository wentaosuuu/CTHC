-- AlterTable: AdminRoleCode 新增 FINANCE（SQLite 以 TEXT 存储枚举，无需改表结构）

-- CreateTable
CREATE TABLE "TransactionReceipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transactionId" TEXT NOT NULL,
    "printCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "reprintApproved" BOOLEAN NOT NULL DEFAULT false,
    "reprintRequestStatus" TEXT,
    "reprintRequestReason" TEXT,
    "reprintRequestedAt" DATETIME,
    "reprintRequestedByAdminId" TEXT,
    "reprintReviewedAt" DATETIME,
    "reprintReviewedByAdminId" TEXT,
    "reprintReviewRemark" TEXT,
    "voidedAt" DATETIME,
    "voidedByAdminId" TEXT,
    "voidReason" TEXT,
    "lastPrintedAt" DATETIME,
    "lastPrintedByAdminId" TEXT,
    "lastReceiptKind" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TransactionReceiptPrintLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transactionReceiptId" TEXT NOT NULL,
    "receiptKind" TEXT NOT NULL,
    "printSeq" INTEGER NOT NULL,
    "printedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "printedByAdminId" TEXT,
    "printedByAdminName" TEXT,
    CONSTRAINT "TransactionReceiptPrintLog_transactionReceiptId_fkey" FOREIGN KEY ("transactionReceiptId") REFERENCES "TransactionReceipt" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "TransactionReceipt_transactionId_key" ON "TransactionReceipt"("transactionId");

-- CreateIndex
CREATE INDEX "TransactionReceipt_reprintRequestStatus_idx" ON "TransactionReceipt"("reprintRequestStatus");

-- CreateIndex
CREATE INDEX "TransactionReceipt_status_idx" ON "TransactionReceipt"("status");

-- CreateIndex
CREATE INDEX "TransactionReceiptPrintLog_transactionReceiptId_printedAt_idx" ON "TransactionReceiptPrintLog"("transactionReceiptId", "printedAt");
