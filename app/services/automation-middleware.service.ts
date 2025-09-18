import type { AdminApiContext } from '@shopify/shopify-app-remix/server';
import { AutomationSchedulerService } from './automation-scheduler.service';
import prisma from '../db.server';

export class AutomationMiddlewareService {
  private static runningAutomations = new Set<string>();
  private static lastChecked = new Map<string, number>();
  private static readonly CHECK_INTERVAL = 30 * 1000; // TEST MODE: 30 seconds between checks per shop

  /**
   * Check and potentially trigger automation for a shop
   * This runs asynchronously and doesn't block the main request
   */
  static async checkAndTriggerAutomation(
    shopDomain: string,
    admin: AdminApiContext
  ): Promise<void> {
    // Don't run if automation is already running for this shop
    if (this.runningAutomations.has(shopDomain)) {
      return;
    }

    // Rate limit checks to avoid excessive database queries
    const lastCheck = this.lastChecked.get(shopDomain) || 0;
    const now = Date.now();
    if (now - lastCheck < this.CHECK_INTERVAL) {
      return;
    }

    this.lastChecked.set(shopDomain, now);

    // Run automation check asynchronously
    setImmediate(() => {
      this.performAutomationCheck(shopDomain, admin).catch(error => {
        console.error(`[AutomationMiddleware] Error checking automation for ${shopDomain}:`, error);
      });
    });
  }

  /**
   * Perform the actual automation check and generation
   */
  private static async performAutomationCheck(
    shopDomain: string,
    admin: AdminApiContext
  ): Promise<void> {
    try {
      const automationService = new AutomationSchedulerService(prisma);

      // Check if automation should run
      const checkResult = await automationService.checkAutomation(shopDomain);

      if (!checkResult.shouldGenerate) {
        console.log(`[AutomationMiddleware] Automation not due for ${shopDomain}: ${checkResult.reason}`);
        return;
      }

      console.log(`[AutomationMiddleware] Starting automation for ${shopDomain}: ${checkResult.reason}`);

      // Mark this shop as having automation running
      this.runningAutomations.add(shopDomain);

      try {
        // Generate blog automatically
        const result = await automationService.generateAutomatedBlog(shopDomain, admin);

        if (result.success) {
          console.log(`[AutomationMiddleware] Successfully generated automated blog for ${shopDomain}: ${result.title}`);
        } else {
          console.error(`[AutomationMiddleware] Failed to generate automated blog for ${shopDomain}: ${result.error}`);
        }
      } finally {
        // Always remove from running set
        this.runningAutomations.delete(shopDomain);
      }

    } catch (error) {
      console.error(`[AutomationMiddleware] Error in automation check for ${shopDomain}:`, error);
      this.runningAutomations.delete(shopDomain);
    }
  }

  /**
   * Get current automation status for debugging
   */
  static getStatus(): {
    runningAutomations: string[];
    lastChecked: Record<string, string>;
  } {
    const lastCheckedFormatted: Record<string, string> = {};
    for (const [shop, timestamp] of this.lastChecked.entries()) {
      lastCheckedFormatted[shop] = new Date(timestamp).toISOString();
    }

    return {
      runningAutomations: Array.from(this.runningAutomations),
      lastChecked: lastCheckedFormatted
    };
  }

  /**
   * Clear status (useful for testing)
   */
  static clearStatus(): void {
    this.runningAutomations.clear();
    this.lastChecked.clear();
  }

  /**
   * Force check automation for a shop (bypasses rate limiting)
   */
  static async forceCheck(shopDomain: string, admin: AdminApiContext): Promise<void> {
    this.lastChecked.set(shopDomain, 0); // Reset last check time
    await this.checkAndTriggerAutomation(shopDomain, admin);
  }
}

/**
 * Helper function to be called from route loaders
 * This is the main entry point for the automation middleware
 */
export async function checkAutomation(
  shopDomain: string,
  admin: AdminApiContext
): Promise<void> {
  try {
    await AutomationMiddlewareService.checkAndTriggerAutomation(shopDomain, admin);
  } catch (error) {
    // Silently handle errors to not affect the main request
    console.error('[AutomationMiddleware] Error in checkAutomation helper:', error);
  }
}