import { AdminApiContext } from "@shopify/shopify-app-remix/server";

export interface ShopInfo {
  id: number;
  name: string;
  domain: string;
  primaryDomain: string;
  email: string;
}

export class ShopifyShopService {
  constructor(private admin: AdminApiContext) {}

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
    const shopInfo = await this.getShopInfo();
    return shopInfo.primaryDomain;
  }

  async getHomepageUrl(): Promise<string> {
    const domain = await this.getShopDomain();
    return `https://${domain}`;
  }
}