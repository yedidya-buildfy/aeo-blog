-- AlterTable
ALTER TABLE "public"."KeywordAnalysis" ADD COLUMN     "customerSearches" TEXT[],
ADD COLUMN     "mainProducts" TEXT[],
ADD COLUMN     "problemsSolved" TEXT[];
