-- CreateTable
CREATE TABLE "AdreLicensee" (
    "id" TEXT NOT NULL,
    "county" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "brokerage" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "licenseType" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3),
    "outcome" TEXT,
    "leadId" TEXT,
    "loadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdreLicensee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdreRoster" (
    "county" TEXT NOT NULL,
    "loadedAt" TIMESTAMP(3) NOT NULL,
    "licenseeCount" INTEGER NOT NULL,

    CONSTRAINT "AdreRoster_pkey" PRIMARY KEY ("county")
);

-- CreateIndex
CREATE INDEX "AdreLicensee_county_checkedAt_position_idx" ON "AdreLicensee"("county", "checkedAt", "position");

