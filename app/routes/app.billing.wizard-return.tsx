import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { ShopifyShopService } from "../services/shopify-shop.service";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { admin, billing } = await authenticate.admin(request);

    const shopService = new ShopifyShopService(admin);
    const shopInfo = await shopService.getShopInfo();
    const shopDomain = shopInfo.primaryDomain || 'unknown';

    console.log(`[WizardReturn] Processing billing return for ${shopDomain}`);

    // Use Shopify's billing.check() to verify subscription status
    const { hasActivePayment, appSubscriptions } = await billing.check();

    if (hasActivePayment && appSubscriptions && appSubscriptions.length > 0) {
      // Payment was successful
      const activeSubscription = appSubscriptions[0];

      // Extract plan from subscription name or default to starter
      let plan = 'starter';
      if (activeSubscription.name?.toLowerCase().includes('pro')) {
        plan = 'pro';
      }

      // Update our database with the active subscription
      await prisma.subscription.upsert({
        where: { shopDomain },
        update: {
          plan: plan as 'starter' | 'pro',
          status: 'active',
          billingOn: new Date(),
          shopifyChargeId: activeSubscription.id
        },
        create: {
          shopDomain,
          plan: plan as 'starter' | 'pro',
          status: 'active',
          billingOn: new Date(),
          shopifyChargeId: activeSubscription.id
        }
      });

      console.log(`[WizardReturn] Payment confirmed for ${plan} plan`);

      // Redirect back to SEO blogs page with wizard at step 3
      const returnUrl = '/app/seo-blogs?showWizard=true&step=3&planConfirmed=true';
      console.log(`[WizardReturn] Redirecting to: ${returnUrl}`);

      return redirect(returnUrl);
    }

    console.log(`[WizardReturn] No active payment found for ${shopDomain}`);

    // Payment failed or was cancelled - reset to free plan
    await prisma.subscription.upsert({
      where: { shopDomain },
      update: {
        status: 'active',
        plan: 'free'
      },
      create: {
        shopDomain,
        status: 'active',
        plan: 'free'
      }
    });

    // Redirect back to step 2 with error message
    const errorUrl = '/app/seo-blogs?showWizard=true&step=2&paymentError=true';
    console.log(`[WizardReturn] Payment failed, redirecting to: ${errorUrl}`);

    return redirect(errorUrl);

  } catch (error) {
    console.error('[WizardReturn] Error processing billing return:', error);

    // Redirect to step 2 with generic error
    const errorUrl = '/app/seo-blogs?showWizard=true&step=2&error=billing_error';
    return redirect(errorUrl);
  }
};