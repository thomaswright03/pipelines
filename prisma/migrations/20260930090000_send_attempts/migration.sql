-- Per-lead record of failed send attempts, so a lead whose sends fail or
-- whose address the mail server refuses is visible on the lead list and
-- page, and a temporarily refused address is retried only a few times.
-- Additive only (nullable / defaulted columns): the previous deployment
-- keeps working while this release rolls out.
ALTER TABLE "Lead" ADD COLUMN "lastSendFailedAt" TIMESTAMP(3);
ALTER TABLE "Lead" ADD COLUMN "lastSendFailure" TEXT;
ALTER TABLE "Lead" ADD COLUMN "sendRefusalCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AgentLead" ADD COLUMN "lastSendFailedAt" TIMESTAMP(3);
ALTER TABLE "AgentLead" ADD COLUMN "lastSendFailure" TEXT;
ALTER TABLE "AgentLead" ADD COLUMN "sendRefusalCount" INTEGER NOT NULL DEFAULT 0;
