-- The Garbage AI pipeline's own tables (see schema.prisma, "Garbage AI pipeline").
-- Only creates new tables: nothing existing is changed.

-- CreateTable
CREATE TABLE "HaulerLead" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "services" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "website" TEXT,
    "source" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "callOutcome" TEXT,
    "starred" BOOLEAN NOT NULL DEFAULT false,
    "emailCheckedAt" TIMESTAMP(3),
    "emailLookupFailedAt" TIMESTAMP(3),
    "emailEvidence" TEXT,
    "emailRulesVersion" TEXT,
    "sendBlockedReason" TEXT,
    "lastSendFailedAt" TIMESTAMP(3),
    "lastSendFailure" TEXT,
    "sendRefusalCount" INTEGER NOT NULL DEFAULT 0,
    "lastEmailedAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "ourReplyAt" TIMESTAMP(3),
    "replyNeedsReview" BOOLEAN NOT NULL DEFAULT false,
    "replyReviewReason" TEXT,
    "estimatedValueCents" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HaulerLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HaulerLeadActivity" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HaulerLeadActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HaulerEmailSendLog" (
    "id" TEXT NOT NULL,
    "leadId" TEXT,
    "email" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bounced" BOOLEAN NOT NULL DEFAULT false,
    "bouncedAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "subject" TEXT,
    "templateVersion" TEXT,

    CONSTRAINT "HaulerEmailSendLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrapedHaulerCity" (
    "id" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "queriedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScrapedHaulerCity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HaulerLead_status_idx" ON "HaulerLead"("status");

-- CreateIndex
CREATE INDEX "HaulerLead_email_idx" ON "HaulerLead"("email");

-- CreateIndex
CREATE INDEX "HaulerLeadActivity_leadId_date_idx" ON "HaulerLeadActivity"("leadId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "HaulerEmailSendLog_providerMessageId_key" ON "HaulerEmailSendLog"("providerMessageId");

-- CreateIndex
CREATE INDEX "HaulerEmailSendLog_leadId_idx" ON "HaulerEmailSendLog"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "ScrapedHaulerCity_city_state_key" ON "ScrapedHaulerCity"("city", "state");

-- AddForeignKey
ALTER TABLE "HaulerLeadActivity" ADD CONSTRAINT "HaulerLeadActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "HaulerLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HaulerEmailSendLog" ADD CONSTRAINT "HaulerEmailSendLog_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "HaulerLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Only the statuses Garbage AI knows (src/lib/lead-status.ts) may be
-- written. The table is new and empty, so the constraint is valid at once.
ALTER TABLE "HaulerLead" ADD CONSTRAINT "HaulerLead_status_check" CHECK (status IN (
  'new', 'contacted', 'responded', 'demo_booked', 'signed_up', 'paying_client', 'not_interested',
  'cold_call_list', 'contactless_list', 'lost'
));
