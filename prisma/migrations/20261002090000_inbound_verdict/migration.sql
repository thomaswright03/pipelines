-- The reply classifier's verdict on each person-written reply: "opt_out",
-- "positive", "declined", "acknowledged" or "needs_look" (see
-- src/lib/outreach/reply-classifier.ts). "declined" and "acknowledged" hold
-- every further email to the sender's address (src/lib/outreach/send.ts).
-- Additive only; earlier rows get the verdict their stored fields imply.
ALTER TABLE "InboundReply" ADD COLUMN "verdict" TEXT;
UPDATE "InboundReply"
SET "verdict" = CASE
  WHEN "optedOut" THEN 'opt_out'
  WHEN "reviewReason" IS NOT NULL THEN 'needs_look'
  ELSE 'positive'
END
WHERE "kind" = 'reply';
CREATE INDEX "InboundReply_fromEmail_verdict_idx" ON "InboundReply"("fromEmail", "verdict");

-- Which version of the rules made the decision an operator corrected (the
-- address finder's emailRulesVersion, the reply rules' version), so the
-- Replies page can show corrections per rules version.
ALTER TABLE "OutreachCorrection" ADD COLUMN "rulesVersion" TEXT;
