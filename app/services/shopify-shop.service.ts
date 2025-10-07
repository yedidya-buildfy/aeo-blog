import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

export interface ShopInfo {
  id: number;
  name: string;
  domain: string;
  primaryDomain: string;
  email: string;
}

export class ShopifyShopService {
  constructor(private admin: AdminApiContext<any>) {}

  async getShopInfo(): Promise<ShopInfo> {
    const query = `
      query {
        shop {
          id
          name
          myshopifyDomain
          primaryDomain {
            host
          }
          email
        }
      }
    `;

    const response = await this.admin.graphql(query);
    const data = await response.json();

    if (data.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
    }

    if (!data.data?.shop) {
      throw new Error('Shop information not found');
    }

    const shop = data.data.shop;
    
    return {
      id: parseInt(shop.id.replace('gid://shopify/Shop/', '')),
      name: shop.name,
      domain: shop.myshopifyDomain,
      primaryDomain: shop.primaryDomain?.host || shop.myshopifyDomain,
      email: shop.email,
    };
  }

  async getShopDomain(): Promise<string> {
    // DEV NOTE: Original code for production
    // const shopInfo = await this.getShopInfo();
    // return shopInfo.primaryDomain;

    // TEMP TEST: Using drive-buddy.com for testing
    return 'drive-buddy.com';
  }

  async getHomepageUrl(): Promise<string> {
    // DEV NOTE: Original code for production
    // const domain = await this.getShopDomain();
    // return `https://${domain}`;

    // TEMP TEST: Using drive-buddy.com for testing
    return 'https://drive-buddy.com';
  }

  async getWizardState(): Promise<{ completed: boolean; step?: number } | null> {
    const query = `
      query {
        shop {
          metafield(namespace: "aeo_wizard", key: "state") {
            value
          }
        }
      }
    `;

    try {
      const response = await this.admin.graphql(query);
      const data = await response.json();

      if (data.errors) {
        console.error('GraphQL errors getting wizard state:', data.errors);
        return null;
      }

      const metafield = data.data?.shop?.metafield;

      if (!metafield?.value) {
        return null;
      }

      const parsedState = JSON.parse(metafield.value);
      return parsedState;
    } catch (error) {
      console.error('Error getting wizard state:', error);
      return null;
    }
  }

  async setWizardState(state: { completed: boolean; step?: number }): Promise<boolean> {
    const shopInfo = await this.getShopInfo();
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
        value: JSON.stringify(state),
        ownerId: shopGid
      }]
    };

    try {
      const response = await this.admin.graphql(mutation, { variables });
      const data = await response.json();

      if (data.errors || data.data?.metafieldsSet?.userErrors?.length > 0) {
        console.error('Error setting wizard state:', data.errors || data.data?.metafieldsSet?.userErrors);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error setting wizard state:', error);
      return false;
    }
  }
}