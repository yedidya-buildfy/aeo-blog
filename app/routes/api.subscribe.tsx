import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { ShopifyShopService } from "../services/shopify-shop.service";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  console.log(`[SUBSCRIBE ROUTE] Called with method: ${request.method}`);

  try {
    const { admin, session } = await authenticate.admin(request);
    const formData = await request.formData();
    const plan = formData.get('plan') as string;

    if (!plan || (plan !== 'starter' && plan !== 'pro')) {
      return json({ success: false, error: 'Invalid plan selected' }, { status: 400 });
    }

    console.log(`[SUBSCRIBE ROUTE] Creating subscription for plan: ${plan}`);

    // Define plan details
    const planConfig = {
      starter: { name: 'Starter Plan', price: 4.99 },
      pro: { name: 'Pro Plan', price: 9.99 }
    };

    const selectedPlan = planConfig[plan as 'starter' | 'pro'];

    // Get shop info for database operations
    const shopService = new ShopifyShopService(admin);
    const shopInfo = await shopService.getShopInfo();
    const shopDomain = shopInfo.primaryDomain || 'unknown';

    console.log(`[SUBSCRIBE ROUTE] Shop: ${shopDomain}, Plan: ${selectedPlan.name}`);

    // Construct return URL - use Shopify admin URL to properly re-enter the embedded app
    // Extract store handle from shop domain (remove .myshopify.com)
    const storeHandle = shopDomain.replace('.myshopify.com', '');

    // Get app handle from toml (it's "aeo-blog" based on your structure)
    const appHandle = 'aeo-blog';

    // Build the full Shopify admin URL that will re-embed the app properly
    const returnUrl = `https://admin.shopify.com/store/${storeHandle}/apps/${appHandle}/app/seo-blogs?plan=${plan}&billing=success&showWizard=true&step=3`;

    console.log(`[SUBSCRIBE ROUTE] Return URL: ${returnUrl}`);

    // Use direct GraphQL mutation (works with fetch-based calls)
    const mutation = `
      mutation CreateAppSubscription($name: String!, $returnUrl: URL!, $test: Boolean, $lineItems: [AppSubscriptionLineItemInput!]!) {
        appSubscriptionCreate(
          name: $name
          returnUrl: $returnUrl
          test: $test
          lineItems: $lineItems
        ) {
          appSubscription {
            id
            status
            name
          }
          confirmationUrl
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      name: selectedPlan.name,
      returnUrl,
      test: process.env.NODE_ENV !== 'production',
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              price: {
                amount: selectedPlan.price,
                currencyCode: 'USD'
              },
              interval: 'EVERY_30_DAYS'
            }
          }
        }
      ]
    };

    console.log(`[SUBSCRIBE ROUTE] Calling GraphQL with returnUrl: ${returnUrl}`);

    const response = await admin.graphql(mutation, { variables });
    const result = await response.json();

    console.log('[SUBSCRIBE ROUTE] GraphQL response:', JSON.stringify(result, null, 2));

    // Check for GraphQL errors
    if (result.errors) {
      console.error('[SUBSCRIBE ROUTE] GraphQL errors:', result.errors);
      return json({
        success: false,
        error: `GraphQL error: ${result.errors[0]?.message || 'Unknown error'}`
      }, { status: 500 });
    }

    // Check for user errors
    if (result.data?.appSubscriptionCreate?.userErrors?.length > 0) {
      const error = result.data.appSubscriptionCreate.userErrors[0];
      console.error('[SUBSCRIBE ROUTE] Subscription error:', error);
      return json({
        success: false,
        error: `Subscription failed: ${error.message}`
      }, { status: 400 });
    }

    const confirmationUrl = result.data?.appSubscriptionCreate?.confirmationUrl;
    const subscriptionId = result.data?.appSubscriptionCreate?.appSubscription?.id;

    if (!confirmationUrl) {
      return json({
        success: false,
        error: 'No confirmation URL received from Shopify'
      }, { status: 500 });
    }

    // Save pending subscription to database
    await prisma.subscription.upsert({
      where: { shopDomain },
      update: {
        plan: plan as 'starter' | 'pro',
        status: 'pending',
        shopifyChargeId: subscriptionId
      },
      create: {
        shopDomain,
        plan: plan as 'starter' | 'pro',
        status: 'pending',
        shopifyChargeId: subscriptionId
      }
    });

    console.log(`[SUBSCRIBE ROUTE] Subscription saved as pending, returning confirmationUrl`);

    // Return the confirmation URL for client-side redirect
    return json({
      success: true,
      confirmationUrl
    });

  } catch (error) {
    console.error('[SUBSCRIBE ROUTE] Error:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create subscription'
    }, { status: 500 });
  }
};