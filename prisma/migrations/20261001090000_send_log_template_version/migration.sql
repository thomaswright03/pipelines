-- Which pitch each send used: the subject line as sent and a fingerprint of
-- the template's wording (see src/lib/email-template-version.ts), so reply
-- rates can be compared across copy changes. Null for sends made before this.
ALTER TABLE "EmailSendLog" ADD COLUMN "subject" TEXT;
ALTER TABLE "EmailSendLog" ADD COLUMN "templateVersion" TEXT;
ALTER TABLE "LeadEmailSendLog" ADD COLUMN "subject" TEXT;
ALTER TABLE "LeadEmailSendLog" ADD COLUMN "templateVersion" TEXT;
