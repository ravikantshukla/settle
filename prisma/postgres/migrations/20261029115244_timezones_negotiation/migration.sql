-- CreateEnum
CREATE TYPE "ReplyCategory" AS ENUM ('PROMISE_TO_PAY', 'HARDSHIP', 'DISPUTE', 'OTHER');

-- AlterEnum
ALTER TYPE "AgentActionStatus" ADD VALUE 'SCHEDULED';

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "country" TEXT,
ADD COLUMN     "timezone" TEXT;

-- AlterTable
ALTER TABLE "AgentAction" ADD COLUMN     "scheduledFor" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ClientReply" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "category" "ReplyCategory" NOT NULL,
    "summary" TEXT,
    "promisedDate" TIMESTAMP(3),
    "request" JSONB,
    "warnings" JSONB,
    "model" TEXT,
    "actionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientReply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientReply_invoiceId_idx" ON "ClientReply"("invoiceId");

-- AddForeignKey
ALTER TABLE "ClientReply" ADD CONSTRAINT "ClientReply_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

