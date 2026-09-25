-- Reply/call history for dataleadsell leads (AgentLeadActivity), retrying
-- lookups whose website was unreachable, a reason on "needs review" replies,
-- and a log of operator corrections to the automatic heuristics. Additive only.

-- AlterTable
ALTER TABLE "AdreLicensee" ADD COLUMN     "lookupFailedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "AgentLead" ADD COLUMN     "emailLookupFailedAt" TIMESTAMP(3),
ADD COLUMN     "replyReviewReason" TEXT;

-- AlterTable
ALTER TABLE "InboundReply" ADD COLUMN     "reviewReason" TEXT;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "emailLookupFailedAt" TIMESTAMP(3),
ADD COLUMN     "replyReviewReason" TEXT;

-- CreateTable
CREATE TABLE "OutreachCorrection" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "pipeline" TEXT,
    "leadId" TEXT,
    "email" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutreachCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentLeadActivity" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentLeadActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutreachCorrection_kind_createdAt_idx" ON "OutreachCorrection"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "AgentLeadActivity_leadId_date_idx" ON "AgentLeadActivity"("leadId", "date");

-- CreateIndex
CREATE INDEX "LeadActivity_leadId_date_idx" ON "LeadActivity"("leadId", "date");

-- AddForeignKey
ALTER TABLE "AgentLeadActivity" ADD CONSTRAINT "AgentLeadActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "AgentLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

