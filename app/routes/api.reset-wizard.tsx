import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { ShopifyShopService } from "../services/shopify-shop.service";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const { admin } = await authenticate.admin(request);
    const shopService = new ShopifyShopService(admin);

    // Delete the wizard state metafield by setting it to null
    const shopInfo = await shopService.getShopInfo();
    const shopGid = `gid://shopify/Shop/${shopInfo.id}`;

    const mutation = `
      mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
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
        type: "json",
        value: null, // This will delete the metafield
        ownerId: shopGid
      }]
    };

    const response = await admin.graphql(mutation, { variables });
    const data = await response.json();

    if (data.errors || data.data?.metafieldsSet?.userErrors?.length > 0) {
      console.error('Error resetting wizard state:', data.errors || data.data?.metafieldsSet?.userErrors);
      return json({ success: false, error: 'Failed to reset wizard state' });
    }

    console.log('[ResetWizard] Successfully reset wizard state for', shopInfo.primaryDomain);

    return json({
      success: true,
      message: 'Wizard state reset successfully. Wizard will now show for this shop.'
    });

  } catch (error) {
    console.error('[ResetWizard] Error:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to reset wizard state'
    }, { status: 500 });
  }
};