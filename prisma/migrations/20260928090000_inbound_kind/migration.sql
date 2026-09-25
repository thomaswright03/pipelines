-- Automatic replies and bounce notices arriving on the reply inbox are told
-- apart from replies a person wrote (src/lib/outreach/auto-mail.ts).
-- Additive only: existing rows are replies, as before.
ALTER TABLE "InboundReply" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'reply';
ALTER TABLE "InboundReply" ADD COLUMN "kindReason" TEXT;
ALTER TABLE "InboundReply" ADD COLUMN "failedRecipient" TEXT;
