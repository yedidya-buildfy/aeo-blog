-- CreateTable
CREATE TABLE "public"."Backup" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "content" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Backup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AEOOperation" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AEOOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Backup_shopDomain_fileName_idx" ON "public"."Backup"("shopDomain", "fileName");

-- CreateIndex
CREATE INDEX "AEOOperation_shopDomain_idx" ON "public"."AEOOperation"("shopDomain");
