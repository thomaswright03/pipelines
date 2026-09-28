-- Record which version of the heuristic rules made each stored decision.
ALTER TABLE "InboundReply" ADD COLUMN "rulesVersion" TEXT;
ALTER TABLE "AgentLead" ADD COLUMN "emailRulesVersion" TEXT;
ALTER TABLE "Lead" ADD COLUMN "emailRulesVersion" TEXT;
