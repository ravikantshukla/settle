-- AlterTable
ALTER TABLE "AgentAction" ADD COLUMN "scheduledFor" DATETIME;

-- AlterTable
ALTER TABLE "Client" ADD COLUMN "country" TEXT;
ALTER TABLE "Client" ADD COLUMN "timezone" TEXT;

-- CreateTable
CREATE TABLE "ClientReply" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "receivedAt" DATETIME NOT NULL,
    "category" TEXT NOT NULL,
    "summary" TEXT,
    "promisedDate" DATETIME,
    "request" JSONB,
    "warnings" JSONB,
    "model" TEXT,
    "actionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClientReply_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ClientReply_invoiceId_idx" ON "ClientReply"("invoiceId");
