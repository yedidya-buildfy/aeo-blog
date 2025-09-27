import { PrismaClient, Subscription } from '@prisma/client';
import { GraphQLClient } from '@shopify/admin-api-client';
import { startOfWeek } from 'date-fns';

export type PlanType = 'free' | 'starter' | 'pro';

export interface PlanConfig {
  name: string;
  price: number;
  blogLimit: number;
  autoLlms: boolean;
  features: string[];
}

export interface UsageInfo {
  blogsGenerated: number;
  blogLimit: number;
  llmsGenerated: number;
  canGenerateBlog: boolean;
  canGenerateLlms: boolean;
}

export interface SubscriptionInfo {
  plan: PlanType;
  status: string;
  billingOn?: Date;
  shopifyChargeId?: string;
}

export class BillingService {
  private planConfigs: Record<PlanType, PlanConfig> = {
    free: {
      name: 'Free Plan',
      price: 0,
      blogLimit: 1,
      autoLlms: false,
      features: ['1 blog per week', 'Manual keyword generation', 'Basic SEO optimization', '1-time LLMs.txt generation']
    },
    starter: {
      name: 'Starter Plan',
      price: 4.99,
      blogLimit: 2,
      autoLlms: false,
      features: ['2 blogs per week', 'Automated keyword generation', 'Enhanced SEO optimization', '1-time LLMs.txt generation']
    },
    pro: {
      name: 'Pro Plan',
      price: 9.99,
      blogLimit: 5,
      autoLlms: true,
      features: ['5 blogs per week', 'Auto LLMs.txt generation every 2 weeks', 'Premium SEO features', 'Priority support']
    }
  };

  constructor(
    private prisma: PrismaClient,
    private admin?: GraphQLClient
  ) {}

  /**
   * Get plan configuration
   */
  getPlanConfig(plan: PlanType): PlanConfig {
    return this.planConfigs[plan];
  }

  /**
   * Get all available plans
   */
  getAllPlans(): Record<PlanType, PlanConfig> {
    return this.planConfigs;
  }

  /**
   * Get current subscription for a shop
   */
  async getSubscription(shopDomain: string): Promise<SubscriptionInfo | null> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { shopDomain }
    });

    if (!subscription) {
      return {
        plan: 'free',
        status: 'active'
      };
    }

    return {
      plan: subscription.plan as PlanType,
      status: subscription.status,
      billingOn: subscription.billingOn || undefined,
      shopifyChargeId: subscription.shopifyChargeId || undefined
    };
  }

  /**
   * Get current usage for a shop
   */
  async getUsage(shopDomain: string): Promise<UsageInfo> {
    const subscription = await this.getSubscription(shopDomain);
    const plan = subscription?.plan || 'free';
    const planConfig = this.getPlanConfig(plan);

    // Get current week's usage
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 }); // Monday
    const usage = await this.prisma.usageTracking.findUnique({
      where: {
        shopDomain_weekStart: {
          shopDomain,
          weekStart
        }
      }
    });

    const blogsGenerated = usage?.blogsGenerated || 0;
    const llmsGenerated = usage?.llmsGenerated || 0;

    return {
      blogsGenerated,
      blogLimit: planConfig.blogLimit,
      llmsGenerated,
      canGenerateBlog: blogsGenerated < planConfig.blogLimit,
      canGenerateLlms: planConfig.autoLlms
    };
  }

  /**
   * Check if user can generate a blog
   */
  async canGenerateBlog(shopDomain: string): Promise<boolean> {
    const usage = await this.getUsage(shopDomain);
    return usage.canGenerateBlog;
  }

  /**
   * Increment blog usage
   */
  async incrementBlogUsage(shopDomain: string): Promise<void> {
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });

    await this.prisma.usageTracking.upsert({
      where: {
        shopDomain_weekStart: {
          shopDomain,
          weekStart
        }
      },
      update: {
        blogsGenerated: {
          increment: 1
        }
      },
      create: {
        shopDomain,
        weekStart,
        blogsGenerated: 1,
        llmsGenerated: 0
      }
    });
  }

  /**
   * Increment LLMs usage
   */
  async incrementLlmsUsage(shopDomain: string): Promise<void> {
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });

    await this.prisma.usageTracking.upsert({
      where: {
        shopDomain_weekStart: {
          shopDomain,
          weekStart
        }
      },
      update: {
        llmsGenerated: {
          increment: 1
        }
      },
      create: {
        shopDomain,
        weekStart,
        blogsGenerated: 0,
        llmsGenerated: 1
      }
    });
  }

  /**
   * Create a Shopify subscription using built-in billing API
   */
  async createSubscription(shopDomain: string, plan: 'starter' | 'pro'): Promise<{
    success: boolean;
    confirmationUrl?: string;
    error?: string;
  }> {
    const planConfig = this.getPlanConfig(plan);
    const returnUrl = `${process.env.SHOPIFY_APP_URL}/app/billing/wizard-return`;

    try {
      console.log(`[BillingService] Creating subscription for ${plan} plan (${planConfig.name})`);

      // For development stores, create a direct confirmation URL to the billing page
      if (process.env.NODE_ENV !== 'production') {
        console.log('[BillingService] Development mode: creating manual billing URL');

        // Save pending subscription to database
        await this.prisma.subscription.upsert({
          where: { shopDomain },
          update: {
            plan,
            status: 'pending',
            shopifyChargeId: `dev_${plan}_${Date.now()}`
          },
          create: {
            shopDomain,
            plan,
            status: 'pending',
            shopifyChargeId: `dev_${plan}_${Date.now()}`
          }
        });

        // For development, use the existing billing page approach
        return {
          success: true,
          confirmationUrl: `${process.env.SHOPIFY_APP_URL}/app/billing?plan=${plan}&return_url=${encodeURIComponent(returnUrl)}`
        };
      }

      // For production, use actual Shopify billing API
      // This would be implemented when deploying to production
      return {
        success: false,
        error: 'Production billing not yet implemented'
      };

    } catch (error) {
      console.error('Error creating subscription:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create subscription'
      };
    }
  }

  /**
   * Cancel a subscription
   */
  async cancelSubscription(shopDomain: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    if (!this.admin) {
      return { success: false, error: 'Admin API client not available' };
    }

    try {
      const subscription = await this.prisma.subscription.findUnique({
        where: { shopDomain }
      });

      if (!subscription?.shopifyChargeId) {
        return { success: false, error: 'No active subscription found' };
      }

      const mutation = `
        mutation appSubscriptionCancel($id: ID!) {
          appSubscriptionCancel(id: $id) {
            appSubscription {
              id
              status
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const variables = {
        id: subscription.shopifyChargeId
      };

      const response = await this.admin.graphql(mutation, { variables });
      const data = response.data as any;

      if (data.appSubscriptionCancel.userErrors?.length > 0) {
        return {
          success: false,
          error: data.appSubscriptionCancel.userErrors[0].message
        };
      }

      // Update subscription status to cancelled
      await this.prisma.subscription.update({
        where: { shopDomain },
        data: {
          status: 'cancelled',
          plan: 'free'
        }
      });

      return { success: true };

    } catch (error) {
      console.error('Error cancelling subscription:', error);
      return {
        success: false,
        error: 'Failed to cancel subscription'
      };
    }
  }

  /**
   * Update subscription status (used by webhooks)
   */
  async updateSubscriptionStatus(
    shopifyChargeId: string,
    status: string,
    billingOn?: Date
  ): Promise<void> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { shopifyChargeId }
    });

    if (subscription) {
      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status,
          billingOn
        }
      });
    }
  }

  /**
   * Reset weekly usage (to be called by a cron job)
   */
  async resetWeeklyUsage(): Promise<void> {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    await this.prisma.usageTracking.deleteMany({
      where: {
        weekStart: {
          lt: oneWeekAgo
        }
      }
    });
  }

  /**
   * Get shops with Pro plan for LLMs automation
   */
  async getProPlanShops(): Promise<string[]> {
    const proSubscriptions = await this.prisma.subscription.findMany({
      where: {
        plan: 'pro',
        status: 'active'
      },
      select: {
        shopDomain: true
      }
    });

    return proSubscriptions.map(sub => sub.shopDomain);
  }
}