-- Only the statuses each pipeline knows (src/lib/lead-status.ts) may be
-- written. NOT VALID: enforced for every insert and update from now on, but
-- existing rows aren't checked, so the migration can't fail on old data.
-- Once no row violates it (see README → Deploying), run:
--   ALTER TABLE "Lead" VALIDATE CONSTRAINT "Lead_status_check";
--   ALTER TABLE "AgentLead" VALIDATE CONSTRAINT "AgentLead_status_check";
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_status_check" CHECK (status IN (
  'new', 'contacted', 'responded', 'appointment_set', 'working_for', 'paying_client',
  'cold_call_list', 'contactless_list', 'lost'
)) NOT VALID;
ALTER TABLE "AgentLead" ADD CONSTRAINT "AgentLead_status_check" CHECK (status IN (
  'new', 'contacted', 'responded', 'subscribed', 'not_interested',
  'cold_call_list', 'contactless_list', 'lost'
)) NOT VALID;
