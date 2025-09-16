import type { PrismaClient } from '@prisma/client';
import type { KeywordContext } from './keyword-aggregation.service';
import * as crypto from 'crypto';

export type ContentAngle = 'how-to' | 'benefits' | 'problems' | 'comparison' | 'trend';

export interface BlogPrompt {
  primaryTopic: string;
  keywordsFocused: string[];
  contentAngle: ContentAngle;
  title: string;
  handle: string;
  contentHash: string;
  isUnique: boolean;
}

export interface TopicTemplate {
  angle: ContentAngle;
  template: string;
  description: string;
  minKeywords: number;
}

export interface UniquenessConstraints {
  maxKeywordOverlap: number; // Percentage (e.g., 60 = 60%)
  minDaysBetweenSimilar: number;
  maxSimilarContentScore: number; // 0-1 scale
}

export class BlogUniquenessService {
  private readonly DEFAULT_CONSTRAINTS: UniquenessConstraints = {
    maxKeywordOverlap: 60,
    minDaysBetweenSimilar: 30,
    maxSimilarContentScore: 0.7
  };

  private readonly TOPIC_TEMPLATES: TopicTemplate[] = [
    {
      angle: 'how-to',
      template: 'Ultimate Guide to {mainProduct} for {customerType}',
      description: 'Step-by-step implementation guides',
      minKeywords: 3
    },
    {
      angle: 'benefits',
      template: 'Top Benefits of {mainProduct} in {currentYear}',
      description: 'Value proposition focused content',
      minKeywords: 2
    },
    {
      angle: 'problems',
      template: 'How {mainProduct} Solves {problemSolved}',
      description: 'Pain point and solution focused',
      minKeywords: 3
    },
    {
      angle: 'comparison',
      template: 'Why Choose {mainProduct} Over Alternatives',
      description: 'Competitive analysis and differentiation',
      minKeywords: 2
    },
    {
      angle: 'trend',
      template: '{mainProduct} Trends and Best Practices for {currentYear}',
      description: 'Market trends and forward-looking content',
      minKeywords: 2
    }
  ];

  constructor(private prisma: PrismaClient) {}

  /**
   * Generate a unique blog prompt that doesn't conflict with existing content
   */
  async generateUniqueBlogPrompt(
    shopDomain: string,
    keywordContext: KeywordContext,
    constraints: Partial<UniquenessConstraints> = {}
  ): Promise<BlogPrompt> {
    const finalConstraints = { ...this.DEFAULT_CONSTRAINTS, ...constraints };

    // Get recent blog posts for this shop
    const recentBlogs = await this.getRecentBlogPosts(
      shopDomain,
      finalConstraints.minDaysBetweenSimilar
    );

    // Find the best content angle to use
    const bestAngle = await this.selectBestContentAngle(shopDomain, recentBlogs);

    // Generate topic variations until we find a unique one
    const maxAttempts = 10;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const prompt = this.generateBlogPromptForAngle(
        bestAngle,
        keywordContext,
        attempt
      );

      // Check uniqueness against existing content
      const uniquenessCheck = await this.checkUniqueness(
        shopDomain,
        prompt,
        recentBlogs,
        finalConstraints
      );

      if (uniquenessCheck.isUnique) {
        console.log(`[BlogUniqueness] Generated unique prompt on attempt ${attempt + 1}`);
        return { ...prompt, isUnique: true };
      }

      console.log(`[BlogUniqueness] Attempt ${attempt + 1} not unique: ${uniquenessCheck.reason}`);
    }

    // If we can't find a unique topic, return the last attempt with a warning
    const fallbackPrompt = this.generateFallbackPrompt(keywordContext);
    console.warn('[BlogUniqueness] Could not generate unique topic, using fallback');

    return { ...fallbackPrompt, isUnique: false };
  }

  /**
   * Check if a blog topic would be unique
   */
  async checkTopicUniqueness(
    shopDomain: string,
    primaryTopic: string,
    keywordsFocused: string[]
  ): Promise<{ isUnique: boolean; reason?: string; similarBlogs: any[] }> {
    const recentBlogs = await this.getRecentBlogPosts(shopDomain, 30);

    // Check for exact topic match
    const exactMatch = recentBlogs.find(blog =>
      blog.primaryTopic.toLowerCase() === primaryTopic.toLowerCase()
    );

    if (exactMatch) {
      return {
        isUnique: false,
        reason: 'Exact topic match found',
        similarBlogs: [exactMatch]
      };
    }

    // Check keyword overlap
    const similarBlogs = recentBlogs.filter(blog => {
      const overlap = this.calculateKeywordOverlap(
        keywordsFocused,
        blog.keywordsFocused
      );
      return overlap > this.DEFAULT_CONSTRAINTS.maxKeywordOverlap;
    });

    if (similarBlogs.length > 0) {
      return {
        isUnique: false,
        reason: `High keyword overlap with ${similarBlogs.length} recent blogs`,
        similarBlogs
      };
    }

    return {
      isUnique: true,
      similarBlogs: []
    };
  }

  /**
   * Get content angle usage statistics
   */
  async getContentAngleStats(shopDomain: string, daysBack: number = 90) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);

    const blogs = await this.prisma.blogPost.findMany({
      where: {
        shopDomain,
        createdAt: { gte: cutoffDate }
      },
      select: {
        contentAngle: true,
        createdAt: true
      }
    });

    const angleStats = blogs.reduce((acc, blog) => {
      const angle = blog.contentAngle as ContentAngle;
      acc[angle] = (acc[angle] || 0) + 1;
      return acc;
    }, {} as Record<ContentAngle, number>);

    return {
      total: blogs.length,
      byAngle: angleStats,
      lastUsed: this.getLastUsedDates(blogs),
      recommendations: this.recommendNextAngles(angleStats)
    };
  }

  /**
   * Generate content hash for duplicate detection
   */
  generateContentHash(
    primaryTopic: string,
    keywordsFocused: string[],
    contentAngle: ContentAngle
  ): string {
    const content = `${primaryTopic}-${keywordsFocused.sort().join(',')}-${contentAngle}`;
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  private async getRecentBlogPosts(shopDomain: string, daysBack: number) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);

    return this.prisma.blogPost.findMany({
      where: {
        shopDomain,
        createdAt: { gte: cutoffDate }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  private async selectBestContentAngle(shopDomain: string, recentBlogs: any[]): Promise<ContentAngle> {
    // Count usage of each angle
    const angleUsage = recentBlogs.reduce((acc, blog) => {
      acc[blog.contentAngle] = (acc[blog.contentAngle] || 0) + 1;
      return acc;
    }, {} as Record<ContentAngle, number>);

    // Find the least used angle
    const angles = this.TOPIC_TEMPLATES.map(t => t.angle);
    let leastUsedAngle = angles[0];
    let minUsage = angleUsage[leastUsedAngle] || 0;

    for (const angle of angles) {
      const usage = angleUsage[angle] || 0;
      if (usage < minUsage) {
        minUsage = usage;
        leastUsedAngle = angle;
      }
    }

    console.log(`[BlogUniqueness] Selected angle: ${leastUsedAngle} (used ${minUsage} times recently)`);
    return leastUsedAngle;
  }

  private generateBlogPromptForAngle(
    angle: ContentAngle,
    keywordContext: KeywordContext,
    variation: number
  ): BlogPrompt {
    const template = this.TOPIC_TEMPLATES.find(t => t.angle === angle);
    if (!template) {
      throw new Error(`Unknown content angle: ${angle}`);
    }

    // Select keywords for this variation
    const selectedKeywords = this.selectKeywordsForVariation(
      keywordContext,
      template.minKeywords,
      variation
    );

    // Generate topic using template
    const primaryTopic = this.fillTemplate(template.template, keywordContext, variation);

    // Generate title (more engaging than topic)
    const title = this.generateTitle(primaryTopic, angle);

    // Generate URL handle
    const handle = this.generateHandle(title);

    // Generate content hash
    const contentHash = this.generateContentHash(primaryTopic, selectedKeywords, angle);

    return {
      primaryTopic,
      keywordsFocused: selectedKeywords,
      contentAngle: angle,
      title,
      handle,
      contentHash,
      isUnique: true // Will be verified later
    };
  }

  private selectKeywordsForVariation(
    keywordContext: KeywordContext,
    minKeywords: number,
    variation: number
  ): string[] {
    const allKeywords = [
      ...keywordContext.mainProducts,
      ...keywordContext.problemsSolved,
      ...keywordContext.customerSearches
    ];

    const requiredCount = Math.max(minKeywords, Math.min(5, allKeywords.length));

    // Use variation to create different keyword combinations
    const startIndex = (variation * 2) % Math.max(1, allKeywords.length - requiredCount + 1);

    return allKeywords.slice(startIndex, startIndex + requiredCount);
  }

  private fillTemplate(template: string, keywordContext: KeywordContext, variation: number): string {
    const currentYear = new Date().getFullYear().toString();
    const mainProduct = keywordContext.mainProducts[variation % keywordContext.mainProducts.length] || 'Products';
    const problemSolved = keywordContext.problemsSolved[0] || 'Common Challenges';
    const customerType = 'Business Owners'; // Could be derived from keywords

    return template
      .replace('{mainProduct}', mainProduct)
      .replace('{problemSolved}', problemSolved)
      .replace('{customerType}', customerType)
      .replace('{currentYear}', currentYear);
  }

  private generateTitle(primaryTopic: string, angle: ContentAngle): string {
    const prefixes = {
      'how-to': ['The Complete', 'Essential', 'Step-by-Step'],
      'benefits': ['Amazing', 'Top', 'Key'],
      'problems': ['How to Solve', 'Overcoming', 'Fixing'],
      'comparison': ['Why Choose', 'The Best', 'Comparing'],
      'trend': ['Latest', '2024', 'Emerging']
    };

    const prefix = prefixes[angle][0];
    return `${prefix} ${primaryTopic}`;
  }

  private generateHandle(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50) + '-' + Date.now().toString().slice(-6);
  }

  private async checkUniqueness(
    shopDomain: string,
    prompt: BlogPrompt,
    recentBlogs: any[],
    constraints: UniquenessConstraints
  ): Promise<{ isUnique: boolean; reason?: string }> {
    // Check content hash collision
    const hashMatch = recentBlogs.find(blog => blog.contentHash === prompt.contentHash);
    if (hashMatch) {
      return { isUnique: false, reason: 'Content hash collision' };
    }

    // Check keyword overlap
    for (const blog of recentBlogs) {
      const overlap = this.calculateKeywordOverlap(
        prompt.keywordsFocused,
        blog.keywordsFocused
      );

      if (overlap > constraints.maxKeywordOverlap) {
        return {
          isUnique: false,
          reason: `${overlap}% keyword overlap with "${blog.primaryTopic}"`
        };
      }
    }

    // Check topic similarity
    const similarTopic = recentBlogs.find(blog =>
      this.calculateTopicSimilarity(prompt.primaryTopic, blog.primaryTopic) > constraints.maxSimilarContentScore
    );

    if (similarTopic) {
      return { isUnique: false, reason: `Similar topic: "${similarTopic.primaryTopic}"` };
    }

    return { isUnique: true };
  }

  private calculateKeywordOverlap(keywords1: string[], keywords2: string[]): number {
    if (!keywords1.length || !keywords2.length) return 0;

    const set1 = new Set(keywords1.map(k => k.toLowerCase()));
    const set2 = new Set(keywords2.map(k => k.toLowerCase()));

    const intersection = new Set(Array.from(set1).filter(x => set2.has(x)));
    const union = new Set([...Array.from(set1), ...Array.from(set2)]);

    return (intersection.size / union.size) * 100;
  }

  private calculateTopicSimilarity(topic1: string, topic2: string): number {
    const words1 = topic1.toLowerCase().split(/\s+/);
    const words2 = topic2.toLowerCase().split(/\s+/);

    const intersection = words1.filter(word => words2.includes(word));
    const unionSet = new Set([...words1, ...words2]);
    const union = Array.from(unionSet);

    return intersection.length / union.length;
  }

  private generateFallbackPrompt(keywordContext: KeywordContext): BlogPrompt {
    const timestamp = Date.now();
    const primaryTopic = `Business Guide: ${keywordContext.mainProducts[0] || 'Success'} - ${timestamp}`;
    const keywordsFocused = keywordContext.mainProducts.slice(0, 3);

    return {
      primaryTopic,
      keywordsFocused,
      contentAngle: 'how-to',
      title: `Essential ${keywordsFocused[0] || 'Business'} Guide`,
      handle: `business-guide-${timestamp}`,
      contentHash: this.generateContentHash(primaryTopic, keywordsFocused, 'how-to'),
      isUnique: false
    };
  }

  private getLastUsedDates(blogs: any[]): Record<ContentAngle, Date | null> {
    const lastUsed: Record<ContentAngle, Date | null> = {
      'how-to': null,
      'benefits': null,
      'problems': null,
      'comparison': null,
      'trend': null
    };

    blogs.forEach(blog => {
      const angle = blog.contentAngle as ContentAngle;
      if (!lastUsed[angle] || blog.createdAt > lastUsed[angle]) {
        lastUsed[angle] = blog.createdAt;
      }
    });

    return lastUsed;
  }

  private recommendNextAngles(angleStats: Record<ContentAngle, number>): ContentAngle[] {
    const angles = Object.keys(angleStats) as ContentAngle[];
    return angles
      .sort((a, b) => (angleStats[a] || 0) - (angleStats[b] || 0))
      .slice(0, 3);
  }
}