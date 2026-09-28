-- Settings → Connections: the last "Test connection" result for the mail
-- service, and the last time Yelp answered or failed. Additive only.
ALTER TABLE "AppSettings" ADD COLUMN "mailTestedAt" TIMESTAMP(3);
ALTER TABLE "AppSettings" ADD COLUMN "mailTestError" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "yelpCheckedAt" TIMESTAMP(3);
ALTER TABLE "AppSettings" ADD COLUMN "yelpCheckError" TEXT;
