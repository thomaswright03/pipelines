-- CreateTable
CREATE TABLE "PipelineMeta" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "productDescription" TEXT NOT NULL,
    "pipelineDescription" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipelineMeta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentLead" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brokerage" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "county" TEXT,
    "state" TEXT,
    "website" TEXT,
    "source" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "starred" BOOLEAN NOT NULL DEFAULT false,
    "lastEmailedAt" TIMESTAMP(3),
    "lastTextedAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "ourReplyAt" TIMESTAMP(3),
    "notes" TEXT,
    "nextFollowUpDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailSendLog" (
    "id" TEXT NOT NULL,
    "leadId" TEXT,
    "email" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bounced" BOOLEAN NOT NULL DEFAULT false,
    "bouncedAt" TIMESTAMP(3),

    CONSTRAINT "EmailSendLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrapedAgentCity" (
    "id" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "county" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "queriedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScrapedAgentCity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
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
    "lastEmailedAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "ourReplyAt" TIMESTAMP(3),
    "estimatedValue" DOUBLE PRECISION,
    "notes" TEXT,
    "nextFollowUpDate" TIMESTAMP(3),
    "appointmentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadActivity" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadEmailSendLog" (
    "id" TEXT NOT NULL,
    "leadId" TEXT,
    "email" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bounced" BOOLEAN NOT NULL DEFAULT false,
    "bouncedAt" TIMESTAMP(3),

    CONSTRAINT "LeadEmailSendLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrapedCity" (
    "id" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "queriedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScrapedCity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScrapedAgentCity_city_county_state_key" ON "ScrapedAgentCity"("city", "county", "state");

-- CreateIndex
CREATE UNIQUE INDEX "ScrapedCity_city_state_key" ON "ScrapedCity"("city", "state");

-- AddForeignKey
ALTER TABLE "EmailSendLog" ADD CONSTRAINT "EmailSendLog_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "AgentLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadEmailSendLog" ADD CONSTRAINT "LeadEmailSendLog_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
