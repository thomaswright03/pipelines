-- AlterTable
ALTER TABLE "EmailSendLog" ADD COLUMN "resendEmailId" TEXT;
CREATE UNIQUE INDEX "EmailSendLog_resendEmailId_key" ON "EmailSendLog"("resendEmailId");

-- AlterTable
ALTER TABLE "LeadEmailSendLog" ADD COLUMN "resendEmailId" TEXT;
CREATE UNIQUE INDEX "LeadEmailSendLog_resendEmailId_key" ON "LeadEmailSendLog"("resendEmailId");
