import type { PrismaClient } from '@prisma/client';

export interface KeywordContext {
  mainProducts: string[];
  problemsSolved: string[];
  customerSearches: string[];
  totalKeywords: number;
  lastUpdated: Date | null;
  shopDomain: string;
}

export interface AggregatedKeywords {
  all: string[];
  byCategory: KeywordContext;
  summary: {
    totalUnique: number;
    mainProductsCount: number;
    problemsSolvedCount: number;
    customerSearchesCount: number;
  };
}

export class KeywordAggregationService {
  private cache: Map<string, { data: AggregatedKeywords; expiry: number }> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(private prisma: PrismaClient) {}

  /**
   * Get aggregated keywords for a shop with caching
   */
  async getAggregatedKeywords(shopDomain: string): Promise<AggregatedKeywords> {
    // Check cache first
    const cacheKey = shopDomain;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() < cached.expiry) {
      console.log(`[KeywordAggregation] Cache hit for ${shopDomain}`);
      return cached.data;
    }

    console.log(`[KeywordAggregation] Fetching fresh data for ${shopDomain}`);
    const aggregated = await this.fetchAndAggregateKeywords(shopDomain);

    // Cache the result
    this.cache.set(cacheKey, {
      data: aggregated,
      expiry: Date.now() + this.CACHE_TTL
    });

    return aggregated;
  }

  /**
   * Get keywords context suitable for AI generation
   */
  async getKeywordContextForGeneration(shopDomain: string): Promise<KeywordContext> {
    const aggregated = await this.getAggregatedKeywords(shopDomain);
    return aggregated.byCategory;
  }

  /**
   * Force refresh keywords from database (clears cache)
   */
  async refreshKeywords(shopDomain: string): Promise<AggregatedKeywords> {
    this.cache.delete(shopDomain);
    return this.getAggregatedKeywords(shopDomain);
  }

  /**
   * Get random keyword subset for content variation
   */
  async getRandomKeywordSubset(
    shopDomain: string,
    maxPerCategory: number = 5
  ): Promise<KeywordContext> {
    const context = await this.getKeywordContextForGeneration(shopDomain);

    return {
      mainProducts: this.shuffleArray(context.mainProducts).slice(0, maxPerCategory),
      problemsSolved: this.shuffleArray(context.problemsSolved).slice(0, maxPerCategory),
      customerSearches: this.shuffleArray(context.customerSearches).slice(0, maxPerCategory),
      totalKeywords: context.totalKeywords,
      lastUpdated: context.lastUpdated,
      shopDomain: context.shopDomain
    };
  }

  /**
   * Check if shop has sufficient keywords for blog generation
   */
  async hasEnoughKeywordsForBlog(shopDomain: string, minTotal: number = 5): Promise<boolean> {
    const aggregated = await this.getAggregatedKeywords(shopDomain);
    return aggregated.summary.totalUnique >= minTotal;
  }

  /**
   * Get keyword statistics for a shop
   */
  async getKeywordStatistics(shopDomain: string) {
    const aggregated = await this.getAggregatedKeywords(shopDomain);
    const byCategory = aggregated.byCategory;

    return {
      shopDomain,
      totalKeywords: aggregated.summary.totalUnique,
      categories: {
        mainProducts: {
          count: aggregated.summary.mainProductsCount,
          examples: byCategory.mainProducts.slice(0, 3)
        },
        problemsSolved: {
          count: aggregated.summary.problemsSolvedCount,
          examples: byCategory.problemsSolved.slice(0, 3)
        },
        customerSearches: {
          count: aggregated.summary.customerSearchesCount,
          examples: byCategory.customerSearches.slice(0, 3)
        }
      },
      lastUpdated: byCategory.lastUpdated
    };
  }

  private async fetchAndAggregateKeywords(shopDomain: string): Promise<AggregatedKeywords> {
    // Get the most recent keyword analysis for the shop
    const analysis = await this.prisma.keywordAnalysis.findFirst({
      where: { shopDomain },
      orderBy: { updatedAt: 'desc' }
    });

    if (!analysis) {
      return this.getEmptyResult(shopDomain);
    }

    const hasCategorizedKeywords =
      Array.isArray(analysis.mainProducts) && analysis.mainProducts.length > 0 ||
      Array.isArray(analysis.problemsSolved) && analysis.problemsSolved.length > 0 ||
      Array.isArray(analysis.customerSearches) && analysis.customerSearches.length > 0;

    let { mainProducts, problemsSolved, customerSearches } = analysis;

    // Fall back to the legacy flat keyword list when no categorized data exists.
    if (!hasCategorizedKeywords && Array.isArray(analysis.keywords) && analysis.keywords.length > 0) {
      const legacyKeywords = analysis.keywords.filter((keyword) => typeof keyword === 'string' && keyword.trim().length > 0);

      if (legacyKeywords.length > 0) {
        const thirds = Math.ceil(legacyKeywords.length / 3);
        mainProducts = legacyKeywords.slice(0, thirds);
        problemsSolved = legacyKeywords.slice(thirds, thirds * 2);
        customerSearches = legacyKeywords.slice(thirds * 2);
      }
    }

    // Clean and deduplicate keywords
    const cleanedMainProducts = this.cleanAndDeduplicateKeywords(mainProducts);
    const cleanedProblemsSolved = this.cleanAndDeduplicateKeywords(problemsSolved);
    const cleanedCustomerSearches = this.cleanAndDeduplicateKeywords(customerSearches);

    // Create all keywords array (deduplicated across categories)
    const allKeywordsSet = new Set([
      ...cleanedMainProducts,
      ...cleanedProblemsSolved,
      ...cleanedCustomerSearches
    ]);
    const allKeywords = Array.from(allKeywordsSet);

    const byCategory: KeywordContext = {
      mainProducts: cleanedMainProducts,
      problemsSolved: cleanedProblemsSolved,
      customerSearches: cleanedCustomerSearches,
      totalKeywords: allKeywords.length,
      lastUpdated: analysis.updatedAt,
      shopDomain
    };

    const summary = {
      totalUnique: allKeywords.length,
      mainProductsCount: cleanedMainProducts.length,
      problemsSolvedCount: cleanedProblemsSolved.length,
      customerSearchesCount: cleanedCustomerSearches.length
    };

    return {
      all: allKeywords,
      byCategory,
      summary
    };
  }

  private cleanAndDeduplicateKeywords(keywords: string[]): string[] {
    if (!keywords || !Array.isArray(keywords)) {
      return [];
    }

    const cleaned = keywords
      .filter(keyword => keyword && typeof keyword === 'string')
      .map(keyword => keyword.trim().toLowerCase())
      .filter(keyword => keyword.length > 2) // Remove very short keywords
      .filter(keyword => !this.isStopWord(keyword)); // Remove common stop words

    // Remove duplicates while preserving original casing
    const uniqueMap = new Map<string, string>();
    keywords.forEach(keyword => {
      const key = keyword.trim().toLowerCase();
      if (cleaned.includes(key) && !uniqueMap.has(key)) {
        uniqueMap.set(key, keyword.trim());
      }
    });

    return Array.from(uniqueMap.values());
  }

  private isStopWord(word: string): boolean {
    const stopWords = new Set([
      'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
      'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had',
      'do', 'does', 'did', 'will', 'would', 'should', 'could', 'can', 'may',
      'might', 'must', 'shall', 'a', 'an', 'this', 'that', 'these', 'those'
    ]);

    return stopWords.has(word.toLowerCase());
  }

  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  private getEmptyResult(shopDomain: string): AggregatedKeywords {
    const byCategory: KeywordContext = {
      mainProducts: [],
      problemsSolved: [],
      customerSearches: [],
      totalKeywords: 0,
      lastUpdated: null,
      shopDomain
    };

    return {
      all: [],
      byCategory,
      summary: {
        totalUnique: 0,
        mainProductsCount: 0,
        problemsSolvedCount: 0,
        customerSearchesCount: 0
      }
    };
  }

  /**
   * Clear all cached data
   */
  clearCache(): void {
    this.cache.clear();
    console.log('[KeywordAggregation] Cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys())
    };
  }
}
