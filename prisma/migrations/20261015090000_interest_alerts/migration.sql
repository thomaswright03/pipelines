-- Interest alerts: a reply read as interested sends Hitta (Thomas's assistant
-- that calls him) an urgent report (src/lib/outreach/interest-alert.ts).
-- The report is stored with the reply so the CSO (the Chief Sales Officer
-- job in thomaswright03/Chief-Sales-Officer) can resend any that didn't get
-- through, and record its own second reading of replies that need a look.
-- Additive only.
ALTER TABLE "InboundReply" ADD COLUMN "interestReport" TEXT;
ALTER TABLE "InboundReply" ADD COLUMN "interestAlertedAt" TIMESTAMP(3);
ALTER TABLE "InboundReply" ADD COLUMN "interestAlertError" TEXT;
ALTER TABLE "InboundReply" ADD COLUMN "csoReviewedAt" TIMESTAMP(3);
ALTER TABLE "InboundReply" ADD COLUMN "csoReading" TEXT;
ALTER TABLE "InboundReply" ADD COLUMN "csoNote" TEXT;
