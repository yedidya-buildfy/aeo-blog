import type { PrismaClient } from '@prisma/client';
import type { AdminApiContext } from '@shopify/shopify-app-remix/server';
import { KeywordAggregationService } from './keyword-aggregation.service';
import { AITopicGeneratorService } from './ai-topic-generator.service';
import { BlogGeneratorService } from './blog-generator.service';
import { ShopifyBlogService } from './shopify-blog.service';

export interface AutomationSchedule {
  id: string;
  shopDomain: string;
  enabled: boolean;
  frequency: string;
  targetDayOfWeek: number;
  targetHourIST: number;
  lastGeneratedAt: Date | null;
  nextTargetDate: Date | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AutomationCheckResult {
  shouldGenerate: boolean;
  schedule?: AutomationSchedule;
  reason?: string;
}

export interface AutomationResult {
  success: boolean;
  blogId?: string;
  title?: string;
  error?: string;
  scheduleUpdated: boolean;
}

export class AutomationSchedulerService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Check if automation should run for a specific shop
   */
  async checkAutomation(shopDomain: string): Promise<AutomationCheckResult> {
    try {
      // Get automation schedule for this shop
      const schedule = await this.prisma.automationSchedule.findUnique({
        where: { shopDomain }
      });

      if (!schedule) {
        return {
          shouldGenerate: false,
          reason: 'No automation schedule found'
        };
      }

      if (!schedule.enabled) {
        return {
          shouldGenerate: false,
          schedule,
          reason: 'Automation disabled'
        };
      }

      if (schedule.status === 'generating') {
        return {
          shouldGenerate: false,
          schedule,
          reason: 'Generation already in progress'
        };
      }

      const now = new Date();
      const israelTime = this.convertToIsraelTime(now);

      // TEST MODE: Check if it's 20:20 or later today (instead of Sunday 10 AM)
      const currentHour = israelTime.getHours();
      const currentMinute = israelTime.getMinutes();
      const isAfterTestTime = currentHour > 20 || (currentHour === 20 && currentMinute >= 20);

      console.log(`[AutomationScheduler] TEST MODE - Current Israel time: ${israelTime.toLocaleString('en-IL', { timeZone: 'Asia/Jerusalem' })}, isAfterTestTime: ${isAfterTestTime}`);

      if (!isAfterTestTime) {
        return {
          shouldGenerate: false,
          schedule,
          reason: `TEST MODE: Not after 20:20 IST yet (current: ${israelTime.toLocaleString('en-IL', { timeZone: 'Asia/Jerusalem' })})`
        };
      }

      // TEST MODE: Check if we already generated in the last 5 minutes (instead of this week)
      if (schedule.lastGeneratedAt) {
        const lastGenerated = this.convertToIsraelTime(schedule.lastGeneratedAt);
        const timeDiff = israelTime.getTime() - lastGenerated.getTime();
        const minutesSinceLastGeneration = timeDiff / (1000 * 60);

        console.log(`[AutomationScheduler] TEST MODE - Minutes since last generation: ${minutesSinceLastGeneration}`);

        if (minutesSinceLastGeneration < 5) {
          return {
            shouldGenerate: false,
            schedule,
            reason: `TEST MODE: Generated ${Math.floor(minutesSinceLastGeneration)} minutes ago, waiting 5 minutes between tests`
          };
        }
      }

      return {
        shouldGenerate: true,
        schedule,
        reason: 'Conditions met for generation'
      };

    } catch (error) {
      console.error('[AutomationScheduler] Error checking automation:', error);
      return {
        shouldGenerate: false,
        reason: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Generate blog automatically for a shop
   */
  async generateAutomatedBlog(
    shopDomain: string,
    admin: AdminApiContext
  ): Promise<AutomationResult> {
    try {
      console.log(`[AutomationScheduler] Starting automated blog generation for ${shopDomain}`);

      // Update status to generating
      await this.updateScheduleStatus(shopDomain, 'generating');

      // Get keyword context
      const keywordService = new KeywordAggregationService(this.prisma);
      const keywordContext = await keywordService.getKeywordContextForGeneration(shopDomain);

      if (keywordContext.totalKeywords === 0) {
        await this.updateScheduleStatus(shopDomain, 'error');
        return {
          success: false,
          error: 'No keywords available for generation',
          scheduleUpdated: true
        };
      }

      // Generate topic
      const topicGenerator = new AITopicGeneratorService(this.prisma);
      const blogPrompt = await topicGenerator.generateUniqueBlogPrompt(
        shopDomain,
        keywordContext,
        `https://${shopDomain}/`
      );

      // Generate blog content
      const blogGenerator = new BlogGeneratorService();
      const generatedBlog = await blogGenerator.generateBlog({
        prompt: blogPrompt,
        keywordContext,
        storeUrl: `https://${shopDomain}/`,
        brandName: shopDomain.split('.')[0] // Simple brand name extraction
      });

      // Publish to Shopify
      const shopifyBlogService = new ShopifyBlogService(admin);
      const publishResult = await shopifyBlogService.createAndPublishBlog({
        generatedBlog,
        published: true
      });

      if (!publishResult.success) {
        await this.updateScheduleStatus(shopDomain, 'error');
        return {
          success: false,
          error: `Failed to publish: ${publishResult.error}`,
          scheduleUpdated: true
        };
      }

      // Save to database
      const blogRecord = await this.prisma.blogPost.create({
        data: {
          shopDomain,
          shopifyBlogId: publishResult.blog!.id,
          shopifyArticleId: publishResult.article!.id,
          keyword: blogPrompt.keywordsFocused[0] || 'general',
          title: generatedBlog.title,
          handle: generatedBlog.handle,
          status: 'published',
          primaryTopic: blogPrompt.primaryTopic,
          keywordsFocused: blogPrompt.keywordsFocused,
          contentHash: blogPrompt.contentHash,
          contentAngle: blogPrompt.contentAngle,
          publishedAt: new Date()
        }
      });

      // Update automation schedule
      await this.updateScheduleAfterGeneration(shopDomain);

      console.log(`[AutomationScheduler] Successfully generated automated blog: ${blogRecord.id}`);

      return {
        success: true,
        blogId: blogRecord.id,
        title: generatedBlog.title,
        scheduleUpdated: true
      };

    } catch (error) {
      console.error('[AutomationScheduler] Error generating automated blog:', error);
      await this.updateScheduleStatus(shopDomain, 'error');

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        scheduleUpdated: true
      };
    }
  }

  /**
   * Enable automation for a shop
   */
  async enableAutomation(
    shopDomain: string,
    targetDayOfWeek: number = 0, // Sunday
    targetHourIST: number = 10 // 10 AM
  ): Promise<AutomationSchedule> {
    const now = new Date();
    const nextTargetDate = this.calculateNextTargetDate(targetDayOfWeek, targetHourIST);

    const schedule = await this.prisma.automationSchedule.upsert({
      where: { shopDomain },
      update: {
        enabled: true,
        targetDayOfWeek,
        targetHourIST,
        nextTargetDate,
        status: 'idle',
        updatedAt: now
      },
      create: {
        shopDomain,
        enabled: true,
        frequency: 'weekly',
        targetDayOfWeek,
        targetHourIST,
        nextTargetDate,
        status: 'idle'
      }
    });

    return schedule;
  }

  /**
   * Disable automation for a shop
   */
  async disableAutomation(shopDomain: string): Promise<AutomationSchedule | null> {
    const schedule = await this.prisma.automationSchedule.findUnique({
      where: { shopDomain }
    });

    if (!schedule) {
      return null;
    }

    return await this.prisma.automationSchedule.update({
      where: { shopDomain },
      data: {
        enabled: false,
        status: 'idle',
        updatedAt: new Date()
      }
    });
  }

  /**
   * Get automation schedule for a shop
   */
  async getSchedule(shopDomain: string): Promise<AutomationSchedule | null> {
    return await this.prisma.automationSchedule.findUnique({
      where: { shopDomain }
    });
  }

  /**
   * Convert UTC time to Israel time
   */
  private convertToIsraelTime(utcDate: Date): Date {
    // Israel is UTC+2 (UTC+3 during DST)
    // Using Intl.DateTimeFormat to handle DST automatically
    const israelTime = new Date(utcDate.toLocaleString('en-US', {
      timeZone: 'Asia/Jerusalem'
    }));
    return israelTime;
  }

  /**
   * Get the start of the week (Sunday) for a given date
   */
  private getWeekStart(date: Date): Date {
    const weekStart = new Date(date);
    const dayOfWeek = weekStart.getDay();
    weekStart.setDate(weekStart.getDate() - dayOfWeek);
    weekStart.setHours(0, 0, 0, 0);
    return weekStart;
  }

  /**
   * Calculate next target date for automation
   */
  private calculateNextTargetDate(targetDayOfWeek: number, targetHourIST: number): Date {
    const now = new Date();
    const israelTime = this.convertToIsraelTime(now);

    const nextTarget = new Date(israelTime);
    nextTarget.setHours(targetHourIST, 0, 0, 0);

    // Calculate days until target day
    const currentDay = israelTime.getDay();
    let daysUntilTarget = targetDayOfWeek - currentDay;

    // If target day is today but time has passed, schedule for next week
    if (daysUntilTarget === 0 && israelTime.getHours() >= targetHourIST) {
      daysUntilTarget = 7;
    } else if (daysUntilTarget < 0) {
      daysUntilTarget += 7;
    }

    nextTarget.setDate(nextTarget.getDate() + daysUntilTarget);

    // Convert back to UTC for storage
    return new Date(nextTarget.toISOString());
  }

  /**
   * Update schedule status
   */
  private async updateScheduleStatus(shopDomain: string, status: string): Promise<void> {
    await this.prisma.automationSchedule.updateMany({
      where: { shopDomain },
      data: {
        status,
        updatedAt: new Date()
      }
    });
  }

  /**
   * Update schedule after successful generation
   */
  private async updateScheduleAfterGeneration(shopDomain: string): Promise<void> {
    const now = new Date();
    const nextTargetDate = this.calculateNextTargetDate(0, 10); // Next Sunday 10 AM

    await this.prisma.automationSchedule.updateMany({
      where: { shopDomain },
      data: {
        lastGeneratedAt: now,
        nextTargetDate,
        status: 'completed',
        updatedAt: now
      }
    });
  }

  /**
   * Get status summary for all enabled automations
   */
  async getAutomationSummary(): Promise<{
    totalEnabled: number;
    pendingGeneration: number;
    inProgress: number;
    errors: number;
  }> {
    const total = await this.prisma.automationSchedule.count({
      where: { enabled: true }
    });

    const inProgress = await this.prisma.automationSchedule.count({
      where: { enabled: true, status: 'generating' }
    });

    const errors = await this.prisma.automationSchedule.count({
      where: { enabled: true, status: 'error' }
    });

    // For pending, we need to check if it's time to generate
    const schedules = await this.prisma.automationSchedule.findMany({
      where: { enabled: true, status: { not: 'generating' } }
    });

    let pendingCount = 0;
    for (const schedule of schedules) {
      const checkResult = await this.checkAutomation(schedule.shopDomain);
      if (checkResult.shouldGenerate) {
        pendingCount++;
      }
    }

    return {
      totalEnabled: total,
      pendingGeneration: pendingCount,
      inProgress,
      errors
    };
  }
}