-- The Room Designer 3D pipeline's own tables (see schema.prisma, "Room Designer 3D pipeline").
-- Only creates new tables: nothing existing is changed.

-- CreateTable
CREATE TABLE "RemodelerLead" (
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

    CONSTRAINT "RemodelerLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RemodelerLeadActivity" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RemodelerLeadActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RemodelerEmailSendLog" (
    "id" TEXT NOT NULL,
    "leadId" TEXT,
    "email" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bounced" BOOLEAN NOT NULL DEFAULT false,
    "bouncedAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "subject" TEXT,
    "templateVersion" TEXT,

    CONSTRAINT "RemodelerEmailSendLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrapedRemodelerCity" (
    "id" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "queriedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScrapedRemodelerCity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RemodelerLead_status_idx" ON "RemodelerLead"("status");

-- CreateIndex
CREATE INDEX "RemodelerLead_email_idx" ON "RemodelerLead"("email");

-- CreateIndex
CREATE INDEX "RemodelerLeadActivity_leadId_date_idx" ON "RemodelerLeadActivity"("leadId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "RemodelerEmailSendLog_providerMessageId_key" ON "RemodelerEmailSendLog"("providerMessageId");

-- CreateIndex
CREATE INDEX "RemodelerEmailSendLog_leadId_idx" ON "RemodelerEmailSendLog"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "ScrapedRemodelerCity_city_state_key" ON "ScrapedRemodelerCity"("city", "state");

-- AddForeignKey
ALTER TABLE "RemodelerLeadActivity" ADD CONSTRAINT "RemodelerLeadActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "RemodelerLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemodelerEmailSendLog" ADD CONSTRAINT "RemodelerEmailSendLog_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "RemodelerLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Only the statuses Room Designer 3D knows (src/lib/lead-status.ts) may be
-- written. The table is new and empty, so the constraint is valid at once.
ALTER TABLE "RemodelerLead" ADD CONSTRAINT "RemodelerLead_status_check" CHECK (status IN (
  'new', 'contacted', 'responded', 'demo_booked', 'free_week', 'paying_customer', 'not_interested',
  'cold_call_list', 'contactless_list', 'lost'
));
