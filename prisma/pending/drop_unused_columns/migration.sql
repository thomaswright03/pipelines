-- Contract step for columns the app no longer reads or writes (they were
-- removed from schema.prisma in round 10; the database still has them).
--
-- NOT applied automatically: this folder is outside prisma/migrations on
-- purpose. Apply it only once a release WITHOUT these columns in
-- schema.prisma is the live deployment on Vercel (an older deployment still
-- selects them and would fail). Then, as the owner:
--
--   mkdir prisma/migrations/<timestamp>_drop_unused_columns
--   git mv prisma/pending/drop_unused_columns/migration.sql prisma/migrations/<timestamp>_drop_unused_columns/
--   PIPELINES_DIRECT_URL="<Neon unpooled URL>" npx prisma migrate deploy
--
-- (docs/deployment.md → "Changing the database schema".)

-- An older deployment may have saved a value into "estimatedValue" during
-- the rollout of 20260927100000_estimated_value_cents: copy it over first.
UPDATE "Lead"
SET "estimatedValueCents" = ROUND("estimatedValue"::numeric * 100)::integer
WHERE "estimatedValue" IS NOT NULL AND "estimatedValueCents" IS NULL;

-- AlterTable
ALTER TABLE "AgentLead" DROP COLUMN "lastTextedAt",
DROP COLUMN "nextFollowUpDate";

-- AlterTable
ALTER TABLE "Lead" DROP COLUMN "estimatedValue",
DROP COLUMN "nextFollowUpDate";

-- AlterTable
ALTER TABLE "PipelineSchedule" DROP COLUMN "hour",
DROP COLUMN "minute";
