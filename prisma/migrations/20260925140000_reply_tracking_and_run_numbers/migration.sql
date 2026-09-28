-- Additive only (safe while the previous deployment is still serving).

-- Replies that arrive on a Lost / Not interested lead are flagged for review.
ALTER TABLE "AgentLead" ADD COLUMN "replyNeedsReview" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Lead" ADD COLUMN "replyNeedsReview" BOOLEAN NOT NULL DEFAULT false;

-- One row per inbound reply processed, so a re-delivered reply is ignored.
CREATE TABLE "InboundReply" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "subject" TEXT,
    "optedOut" BOOLEAN NOT NULL,
    "matched" TEXT[],
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundReply_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "InboundReply_dedupeKey_receivedAt_idx" ON "InboundReply"("dedupeKey", "receivedAt");

-- What each daily run actually did, as numbers.
ALTER TABLE "PipelineRun" ADD COLUMN "businessesChecked" INTEGER;
ALTER TABLE "PipelineRun" ADD COLUMN "leadsFound" INTEGER;
ALTER TABLE "PipelineRun" ADD COLUMN "emailsSent" INTEGER;
