CREATE TABLE "TenantProfileLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "actionLabel" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "operatorKind" TEXT NOT NULL DEFAULT 'ADMIN',
    "adminId" TEXT,
    "adminName" TEXT,
    "adminEmail" TEXT,
    CONSTRAINT "TenantProfileLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TenantProfileLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "TenantProfileLog_tenantId_idx" ON "TenantProfileLog"("tenantId");
CREATE INDEX "TenantProfileLog_occurredAt_idx" ON "TenantProfileLog"("occurredAt");
