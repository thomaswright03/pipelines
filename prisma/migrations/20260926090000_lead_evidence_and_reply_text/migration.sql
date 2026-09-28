-- Additive (safe while the previous deployment is still serving), plus one
-- conservative data change that only ever *stops* sends.

-- Why an automatically found address is believed to be this lead's (the
-- lead's phone, street address or city was on the site it came from), or
-- that it was entered by hand. Shown on the lead page.
ALTER TABLE "AgentLead" ADD COLUMN "emailEvidence" TEXT;
ALTER TABLE "Lead" ADD COLUMN "emailEvidence" TEXT;

-- Unmatched replies: keep the reply's own text so it can be read in the
-- app, and whether the operator has attached it to a lead or dismissed it.
ALTER TABLE "InboundReply" ADD COLUMN "text" TEXT;
ALTER TABLE "InboundReply" ADD COLUMN "resolvedAt" TIMESTAMP(3);
ALTER TABLE "InboundReply" ADD COLUMN "resolution" TEXT;
CREATE INDEX "InboundReply_receivedAt_idx" ON "InboundReply"("receivedAt");

-- Addresses found by the old website guess were never checked against the
-- lead (any site that mentioned one word of the name was accepted). New,
-- not-yet-emailed leads that came from discovery are held back until the
-- operator checks the address on the lead page ("Address checked — allow
-- sending") or edits it. Manually entered leads are left alone.
UPDATE "Lead"
SET "sendBlockedReason" = 'Unverified address — found by an older website guess that didn''t check the site belongs to this lead. Check it, then allow sending or edit the lead.'
WHERE "status" = 'new' AND "email" IS NOT NULL AND "sendBlockedReason" IS NULL
  AND "source" IS NOT NULL AND "source" <> 'Manual entry';
UPDATE "AgentLead"
SET "sendBlockedReason" = 'Unverified address — found by an older website guess that didn''t check the site belongs to this lead. Check it, then allow sending or edit the lead.'
WHERE "status" = 'new' AND "email" IS NOT NULL AND "sendBlockedReason" IS NULL
  AND "source" IS NOT NULL AND "source" <> 'Manual entry';
