-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "splitId" TEXT NOT NULL,
    "agentActionId" TEXT,
    "amount" DECIMAL NOT NULL,
    "currency" TEXT NOT NULL,
    "payoutBatchId" TEXT,
    "payoutItemId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "paidOutAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Payout_splitId_fkey" FOREIGN KEY ("splitId") REFERENCES "PayoutSplit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Payout_payoutItemId_key" ON "Payout"("payoutItemId");

-- CreateIndex
CREATE INDEX "Payout_payoutBatchId_idx" ON "Payout"("payoutBatchId");

-- CreateIndex
CREATE INDEX "Payout_status_idx" ON "Payout"("status");

