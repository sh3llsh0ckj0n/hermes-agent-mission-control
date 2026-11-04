-- AlterTable
ALTER TABLE "AgentRequest" ADD COLUMN "submitter" TEXT,
ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AgentRequest_idempotencyKey_key" ON "AgentRequest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AgentRequest_submitter_createdAt_idx" ON "AgentRequest"("submitter", "createdAt");
