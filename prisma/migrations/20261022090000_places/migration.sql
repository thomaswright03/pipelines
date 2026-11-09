-- Foursquare business data that replaces the Yelp search (see schema.prisma, "Place").
-- Only creates a new table: nothing existing is changed.

-- CreateTable
CREATE TABLE "Place" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "phone" TEXT,
    "website" TEXT,
    "categories" TEXT[],
    "kinds" TEXT[],
    "refreshedAt" TIMESTAMP(3),
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Place_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Place_state_city_idx" ON "Place"("state", "city");
