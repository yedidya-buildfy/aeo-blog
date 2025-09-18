import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { BillingService } from "../services/billing.service";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { topic, shop, payload } = await authenticate.webhook(request);

    console.log(`Received subscription webhook: ${topic} for shop: ${shop}`);
    console.log('Webhook payload:', JSON.stringify(payload, null, 2));

    if (!shop || !payload) {
      console.error('Missing shop or payload in subscription webhook');
      return new Response('Bad Request', { status: 400 });
    }

    const billingService = new BillingService(prisma);

    // Handle different subscription events
    switch (topic) {
      case 'APP_SUBSCRIPTIONS_UPDATE':
        await handleSubscriptionUpdate(payload, shop, billingService);
        break;

      case 'APP_SUBSCRIPTIONS_APPROACHING_CAPPED_AMOUNT':
        await handleSubscriptionApproachingCap(payload, shop, billingService);
        break;

      case 'APP_SUBSCRIPTIONS_CAPPED_AMOUNT_UPDATED':
        await handleSubscriptionCapUpdated(payload, shop, billingService);
        break;

      default:
        console.log(`Unhandled subscription webhook topic: ${topic}`);
    }

    return new Response('OK', { status: 200 });

  } catch (error) {
    console.error('Error processing subscription webhook:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
};

async function handleSubscriptionUpdate(
  payload: any,
  shop: string,
  billingService: BillingService
) {
  try {
    const subscription = payload.app_subscription;

    if (!subscription) {
      console.error('No subscription data in webhook payload');
      return;
    }

    const {
      id: shopifyChargeId,
      status,
      current_period_end,
      name
    } = subscription;

    console.log(`Updating subscription ${shopifyChargeId} to status: ${status}`);

    // Determine plan from subscription name
    let plan = 'free';
    if (name?.toLowerCase().includes('starter')) {
      plan = 'starter';
    } else if (name?.toLowerCase().includes('pro')) {
      plan = 'pro';
    }

    // Update subscription in database
    await billingService.updateSubscriptionStatus(
      shopifyChargeId,
      status,
      current_period_end ? new Date(current_period_end) : undefined
    );

    // If subscription is cancelled or declined, downgrade to free
    if (status === 'CANCELLED' || status === 'DECLINED' || status === 'EXPIRED') {
      await prisma.subscription.upsert({
        where: { shopDomain: shop },
        update: {
          plan: 'free',
          status: 'cancelled',
          shopifyChargeId: null
        },
        create: {
          shopDomain: shop,
          plan: 'free',
          status: 'active'
        }
      });

      console.log(`Downgraded shop ${shop} to free plan due to subscription ${status}`);
    }

    // If subscription is active, update the plan
    if (status === 'ACTIVE') {
      await prisma.subscription.upsert({
        where: { shopDomain: shop },
        update: {
          plan,
          status: 'active',
          shopifyChargeId,
          billingOn: current_period_end ? new Date(current_period_end) : undefined
        },
        create: {
          shopDomain: shop,
          plan,
          status: 'active',
          shopifyChargeId,
          billingOn: current_period_end ? new Date(current_period_end) : undefined
        }
      });

      console.log(`Updated shop ${shop} to ${plan} plan with status: ${status}`);
    }

  } catch (error) {
    console.error('Error handling subscription update:', error);
    throw error;
  }
}

async function handleSubscriptionApproachingCap(
  payload: any,
  shop: string,
  billingService: BillingService
) {
  try {
    console.log(`Subscription approaching cap for shop: ${shop}`);
    // You could send email notifications or log analytics here

  } catch (error) {
    console.error('Error handling subscription approaching cap:', error);
    throw error;
  }
}

async function handleSubscriptionCapUpdated(
  payload: any,
  shop: string,
  billingService: BillingService
) {
  try {
    console.log(`Subscription cap updated for shop: ${shop}`);
    // Handle cap updates if using usage-based billing

  } catch (error) {
    console.error('Error handling subscription cap update:', error);
    throw error;
  }
}