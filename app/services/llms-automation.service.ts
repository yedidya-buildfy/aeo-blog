import { PrismaClient, AEOContent } from '@prisma/client';
import type { AdminApiContext } from '@shopify/shopify-app-remix/server';
import { BillingService } from './billing.service';
import { ShopifyShopService } from './shopify-shop.service';
import { ShopifyThemeService } from './shopify-theme.service';
import { GeminiService } from './gemini.service';
import { BackupService } from './backup.service';
import { UNIVERSAL_ROBOTS_TXT } from '../constants/aeo-templates';

export interface LlmsAutomationResult {
  success: boolean;
  shopDomain: string;
  aeoContentId?: string;
  error?: string;
  llmsGenerated?: boolean;
  robotsUpdated?: boolean;
}

export class LlmsAutomationService {
  constructor(
    private prisma: PrismaClient,
    private admin: AdminApiContext
  ) {}

  /**
   * Check if a shop is eligible for LLMs.txt automation
   */
  async isEligibleForAutomation(shopDomain: string): Promise<{
    eligible: boolean;
    reason?: string;
  }> {
    try {
      const billingService = new BillingService(this.prisma, this.admin);
      const subscription = await billingService.getSubscription(shopDomain);

      // Only Pro plan users get LLMs.txt automation
      if (subscription?.plan !== 'pro') {
        return {
          eligible: false,
          reason: `Shop ${shopDomain} is on ${subscription?.plan || 'free'} plan. LLMs.txt automation requires Pro plan.`
        };
      }

      if (subscription.status !== 'active') {
        return {
          eligible: false,
          reason: `Shop ${shopDomain} has inactive subscription status: ${subscription.status}`
        };
      }

      // Check if LLMs.txt was generated recently (within 2 weeks)
      const twoWeeksAgo = new Date();
      twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

      const recentLlms = await this.prisma.aEOContent.findFirst({
        where: {
          shopDomain,
          createdAt: {
            gte: twoWeeksAgo
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      if (recentLlms) {
        return {
          eligible: false,
          reason: `LLMs.txt was generated recently for ${shopDomain} on ${recentLlms.createdAt.toISOString()}`
        };
      }

      return {
        eligible: true,
        reason: `Shop ${shopDomain} is eligible for LLMs.txt automation`
      };

    } catch (error) {
      console.error('Error checking LLMs automation eligibility:', error);
      return {
        eligible: false,
        reason: `Error checking eligibility: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Generate and apply LLMs.txt for a Pro plan shop
   */
  async generateLlmsForShop(shopDomain: string): Promise<LlmsAutomationResult> {
    try {
      console.log(`[LlmsAutomation] Starting LLMs.txt generation for ${shopDomain}`);

      // Check eligibility first
      const eligibility = await this.isEligibleForAutomation(shopDomain);
      if (!eligibility.eligible) {
        return {
          success: false,
          shopDomain,
          error: eligibility.reason
        };
      }

      // Initialize services
      const shopService = new ShopifyShopService(this.admin);
      const themeService = new ShopifyThemeService(this.admin);
      const geminiService = new GeminiService();
      const backupService = new BackupService(this.prisma);

      // Get shop information
      const shopInfo = await shopService.getShopInfo();
      const homepageUrl = `https://${shopInfo.primaryDomain}/`;

      console.log(`[LlmsAutomation] Generating LLMs content for: ${homepageUrl}`);

      // Generate LLMs content using Gemini
      const generatedLlmsContent = await geminiService.generateLlmsContent(homepageUrl);

      if (!generatedLlmsContent || generatedLlmsContent.trim().length === 0) {
        throw new Error('Gemini API returned empty LLMS content');
      }

      console.log(`[LlmsAutomation] Generated LLMs content (${generatedLlmsContent.length} chars)`);

      // Save generated content to database
      const aeoContent = await backupService.createAEOContent({
        shopDomain,
        sourceUrl: homepageUrl,
        llmsContent: generatedLlmsContent,
        robotsContent: UNIVERSAL_ROBOTS_TXT,
        status: 'generated'
      });

      console.log(`[LlmsAutomation] Saved AEO content with ID: ${aeoContent.id}`);

      // Try to apply to theme (this may fail but shouldn't block the automation)
      let robotsUpdated = false;
      let llmsApplied = false;

      try {
        // Backup existing files first
        await backupService.backupThemeFiles(shopDomain, themeService);

        // Apply LLMs.txt to theme
        const llmsResult = await themeService.createOrUpdateAsset('llms.txt', generatedLlmsContent);
        llmsApplied = llmsResult.success;

        // Apply robots.txt to theme
        const robotsResult = await themeService.createOrUpdateAsset('robots.txt', UNIVERSAL_ROBOTS_TXT);
        robotsUpdated = robotsResult.success;

        console.log(`[LlmsAutomation] Applied to theme - LLMs: ${llmsApplied}, Robots: ${robotsUpdated}`);

      } catch (themeError) {
        console.warn(`[LlmsAutomation] Failed to apply to theme for ${shopDomain}:`, themeError);
        // Continue - content was saved to database successfully
      }

      // Increment LLMs usage counter
      const billingService = new BillingService(this.prisma, this.admin);
      await billingService.incrementLlmsUsage(shopDomain);

      return {
        success: true,
        shopDomain,
        aeoContentId: aeoContent.id,
        llmsGenerated: true,
        robotsUpdated
      };

    } catch (error) {
      console.error(`[LlmsAutomation] Error generating LLMs for ${shopDomain}:`, error);
      return {
        success: false,
        shopDomain,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Run automation for all eligible Pro plan shops
   */
  async runAutomationForAllEligibleShops(): Promise<{
    processed: number;
    successful: number;
    failed: number;
    results: LlmsAutomationResult[];
  }> {
    try {
      console.log('[LlmsAutomation] Starting automation for all eligible shops');

      // Get all Pro plan shops
      const billingService = new BillingService(this.prisma);
      const proShops = await billingService.getProPlanShops();

      console.log(`[LlmsAutomation] Found ${proShops.length} Pro plan shops`);

      const results: LlmsAutomationResult[] = [];
      let successful = 0;
      let failed = 0;

      // Process each shop
      for (const shopDomain of proShops) {
        try {
          const result = await this.generateLlmsForShop(shopDomain);
          results.push(result);

          if (result.success) {
            successful++;
            console.log(`[LlmsAutomation] ✅ Successfully processed ${shopDomain}`);
          } else {
            failed++;
            console.log(`[LlmsAutomation] ❌ Failed to process ${shopDomain}: ${result.error}`);
          }

          // Small delay between shops to avoid overwhelming the API
          await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (shopError) {
          failed++;
          const errorResult: LlmsAutomationResult = {
            success: false,
            shopDomain,
            error: shopError instanceof Error ? shopError.message : 'Unknown error'
          };
          results.push(errorResult);
          console.error(`[LlmsAutomation] ❌ Error processing ${shopDomain}:`, shopError);
        }
      }

      console.log(`[LlmsAutomation] Automation complete: ${successful} successful, ${failed} failed`);

      return {
        processed: proShops.length,
        successful,
        failed,
        results
      };

    } catch (error) {
      console.error('[LlmsAutomation] Error running automation for all shops:', error);
      throw error;
    }
  }

  /**
   * Get next automation date (2 weeks from last generation)
   */
  async getNextAutomationDate(shopDomain: string): Promise<Date | null> {
    try {
      const lastGeneration = await this.prisma.aEOContent.findFirst({
        where: { shopDomain },
        orderBy: { createdAt: 'desc' }
      });

      if (!lastGeneration) {
        return new Date(); // Can run immediately if never generated
      }

      const nextDate = new Date(lastGeneration.createdAt);
      nextDate.setDate(nextDate.getDate() + 14); // Add 2 weeks

      return nextDate;

    } catch (error) {
      console.error('Error getting next automation date:', error);
      return null;
    }
  }
}