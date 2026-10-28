-- AlterTable
ALTER TABLE "AgentAction" ADD COLUMN "pendingKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AgentAction_pendingKey_key" ON "AgentAction"("pendingKey");

