-- CreateTable
CREATE TABLE "public"."KeywordAnalysis" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "storeUrl" TEXT NOT NULL,
    "keywords" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeywordAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BlogPost" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "shopifyBlogId" TEXT NOT NULL,
    "shopifyArticleId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "BlogPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KeywordAnalysis_shopDomain_idx" ON "public"."KeywordAnalysis"("shopDomain");

-- CreateIndex
CREATE INDEX "KeywordAnalysis_storeUrl_idx" ON "public"."KeywordAnalysis"("storeUrl");

-- CreateIndex
CREATE INDEX "BlogPost_shopDomain_idx" ON "public"."BlogPost"("shopDomain");

-- CreateIndex
CREATE INDEX "BlogPost_keyword_idx" ON "public"."BlogPost"("keyword");
