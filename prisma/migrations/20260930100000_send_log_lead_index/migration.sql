-- The Stats pages join leads to their sends ("was this lead emailed?") and
-- the lead page lists a lead's sends; without an index on leadId each of
-- those is a scan of the whole send log per lead.
CREATE INDEX IF NOT EXISTS "EmailSendLog_leadId_idx" ON "EmailSendLog"("leadId");
CREATE INDEX IF NOT EXISTS "LeadEmailSendLog_leadId_idx" ON "LeadEmailSendLog"("leadId");
