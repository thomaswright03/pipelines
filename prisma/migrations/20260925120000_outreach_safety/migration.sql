-- AlterTable
ALTER TABLE "AgentLead" ADD COLUMN     "callOutcome" TEXT,
ADD COLUMN     "sendBlockedReason" TEXT;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "sendBlockedReason" TEXT;

-- AlterTable
ALTER TABLE "SuppressedEmail" ADD COLUMN     "evidence" TEXT,
ADD COLUMN     "source" TEXT;

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL,
    "outboundPaused" BOOLEAN NOT NULL DEFAULT false,
    "pausedAt" TIMESTAMP(3),
    "allowCrossPipelineRepeats" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachRecipient" (
    "id" TEXT NOT NULL,
    "pipeline" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "leadId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'claimed',
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "lastError" TEXT,

    CONSTRAINT "OutreachRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineRun" (
    "id" TEXT NOT NULL,
    "pipeline" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "summary" TEXT,
    "errors" TEXT,

    CONSTRAINT "PipelineRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutreachRecipient_email_idx" ON "OutreachRecipient"("email");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachRecipient_pipeline_email_key" ON "OutreachRecipient"("pipeline", "email");

-- CreateIndex
CREATE INDEX "PipelineRun_pipeline_kind_startedAt_idx" ON "PipelineRun"("pipeline", "kind", "startedAt");

-- CreateIndex
CREATE INDEX "AgentLead_status_idx" ON "AgentLead"("status");

-- CreateIndex
CREATE INDEX "AgentLead_email_idx" ON "AgentLead"("email");

-- CreateIndex
CREATE INDEX "Lead_status_idx" ON "Lead"("status");

-- CreateIndex
CREATE INDEX "Lead_email_idx" ON "Lead"("email");

-- RenameIndex
ALTER INDEX "EmailSendLog_resendEmailId_key" RENAME TO "EmailSendLog_providerMessageId_key";

-- RenameIndex
ALTER INDEX "LeadEmailSendLog_resendEmailId_key" RENAME TO "LeadEmailSendLog_providerMessageId_key";


-- Emails are compared case-insensitively everywhere; store them lower-case
-- so equality lookups (and the indexes above) catch every duplicate.
UPDATE "AgentLead" SET "email" = lower(trim("email")) WHERE "email" IS NOT NULL AND "email" <> lower(trim("email"));
UPDATE "Lead" SET "email" = lower(trim("email")) WHERE "email" IS NOT NULL AND "email" <> lower(trim("email"));

-- Seed the send ledger from the existing send history, so addresses that
-- were already pitched are never pitched again by the new dedupe rule.
INSERT INTO "OutreachRecipient" ("id", "pipeline", "email", "leadId", "state", "claimedAt", "sentAt", "providerMessageId")
SELECT DISTINCT ON (lower(trim(s."email")))
  'backfill_dls_' || md5(lower(trim(s."email"))), 'dataleadsell', lower(trim(s."email")), s."leadId", 'sent', s."sentAt", s."sentAt", s."providerMessageId"
FROM "EmailSendLog" s
ORDER BY lower(trim(s."email")), s."sentAt" ASC
ON CONFLICT ("pipeline", "email") DO NOTHING;

INSERT INTO "OutreachRecipient" ("id", "pipeline", "email", "leadId", "state", "claimedAt", "sentAt", "providerMessageId")
SELECT DISTINCT ON (lower(trim(s."email")))
  'backfill_co_' || md5(lower(trim(s."email"))), 'cold-outreach', lower(trim(s."email")), s."leadId", 'sent', s."sentAt", s."sentAt", s."providerMessageId"
FROM "LeadEmailSendLog" s
ORDER BY lower(trim(s."email")), s."sentAt" ASC
ON CONFLICT ("pipeline", "email") DO NOTHING;
