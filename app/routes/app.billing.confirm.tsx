import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { BillingService } from "../services/billing.service";
import { ShopifyShopService } from "../services/shopify-shop.service";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { admin } = await authenticate.admin(request);
    const url = new URL(request.url);
    const chargeId = url.searchParams.get('charge_id');

    if (chargeId) {
      // Update subscription status to active
      const billingService = new BillingService(prisma, admin);
      await billingService.updateSubscriptionStatus(chargeId, 'active');

      return redirect('/app/billing?confirmed=true');
    }

    return redirect('/app/billing?error=no_charge_id');

  } catch (error) {
    console.error('Error confirming subscription:', error);
    return redirect('/app/billing?error=confirmation_failed');
  }
};