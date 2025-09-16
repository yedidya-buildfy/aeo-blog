-- AlterTable
ALTER TABLE "public"."KeywordAnalysis" ALTER COLUMN "customerSearches" SET DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "mainProducts" SET DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "problemsSolved" SET DEFAULT ARRAY[]::TEXT[];
