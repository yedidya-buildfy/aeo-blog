import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { ShopifyShopService } from "../services/shopify-shop.service";
import prisma from "../db.server";

/**
 * Helper route to completely reset the app to a fresh state
 * Clears both database tables and Shopify metafields
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const { admin } = await authenticate.admin(request);
    const shopService = new ShopifyShopService(admin);
    const shopInfo = await shopService.getShopInfo();
    const shopDomain = shopInfo.primaryDomain;

    console.log('[ClearAllData] Starting complete data reset for:', shopDomain);

    // 1. Clear database tables
    await prisma.$transaction([
      prisma.aEOContent.deleteMany({ where: { shopDomain } }),
      prisma.automationSchedule.deleteMany({ where: { shopDomain } }),
      prisma.backup.deleteMany({ where: { shopDomain } }),
      prisma.blogPost.deleteMany({ where: { shopDomain } }),
      prisma.keywordAnalysis.deleteMany({ where: { shopDomain } }),
      prisma.subscription.deleteMany({ where: { shopDomain } }),
      prisma.topicBatch.deleteMany({ where: { shopDomain } }),
      prisma.usageTracking.deleteMany({ where: { shopDomain } }),
    ]);

    console.log('[ClearAllData] Database tables cleared');

    // 2. Clear wizard state metafield
    const shopGid = `gid://shopify/Shop/${shopInfo.id}`;
    const mutation = `
      mutation metafieldsDelete($metafields: [MetafieldIdentifierInput!]!) {
        metafieldsDelete(metafields: $metafields) {
          deletedMetafields {
            key
            namespace
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      metafields: [{
        namespace: "aeo_wizard",
        key: "state",
        ownerId: shopGid
      }]
    };

    const response = await admin.graphql(mutation, { variables });
    const data = await response.json();

    if (data.errors || data.data?.metafieldsDelete?.userErrors?.length > 0) {
      console.error('[ClearAllData] Error clearing wizard metafield:', data.errors || data.data?.metafieldsDelete?.userErrors);
    } else {
      console.log('[ClearAllData] Wizard metafield cleared');
    }

    console.log('[ClearAllData] Complete reset finished successfully');

    return json({
      success: true,
      message: 'All app data cleared successfully! Wizard will show on next page load.',
      cleared: {
        database: true,
        metafields: true,
        shopDomain
      }
    });

  } catch (error) {
    console.error('[ClearAllData] Error:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to clear data'
    }, { status: 500 });
  }
};
