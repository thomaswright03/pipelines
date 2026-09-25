-- Store a lead's estimated value as whole cents instead of a float.
-- Additive: the old "estimatedValue" column stays (the previous deployment
-- still reads it) and is dropped in a follow-up migration.
ALTER TABLE "Lead" ADD COLUMN "estimatedValueCents" INTEGER;

-- Every existing value is a dollar amount entered with at most two
-- decimals (the form enforces it), so rounding to the nearest cent keeps
-- it exactly.
UPDATE "Lead"
SET "estimatedValueCents" = ROUND(("estimatedValue")::numeric * 100)::integer
WHERE "estimatedValue" IS NOT NULL;
