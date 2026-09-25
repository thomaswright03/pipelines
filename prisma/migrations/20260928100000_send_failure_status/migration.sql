-- The last failed send, for Settings → Connections. Additive only.
ALTER TABLE "AppSettings" ADD COLUMN "lastSendFailedAt" TIMESTAMP(3);
ALTER TABLE "AppSettings" ADD COLUMN "lastSendFailure" TEXT;
