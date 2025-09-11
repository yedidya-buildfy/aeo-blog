import { ShopifyShopService } from '../app/services/shopify-shop.service';

// Mock the admin context
const mockAdmin = {
  rest: {
    resources: {
      Shop: {
        all: jest.fn(),
      }
    }
  },
  graphql: jest.fn()
};

describe('ShopifyShopService', () => {
  let service: ShopifyShopService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ShopifyShopService(mockAdmin as any);
  });

  describe('getShopInfo', () => {
    it('should return shop information', async () => {
      const mockShop = {
        data: [{
          id: 123,
          name: 'Test Shop',
          domain: 'test-shop.myshopify.com',
          primary_domain: {
            host: 'test-shop.com'
          },
          email: 'test@test-shop.com'
        }]
      };
      
      mockAdmin.rest.resources.Shop.all.mockResolvedValue(mockShop);

      const result = await service.getShopInfo();

      expect(result).toEqual({
        id: 123,
        name: 'Test Shop',
        domain: 'test-shop.myshopify.com',
        primaryDomain: 'test-shop.com',
        email: 'test@test-shop.com'
      });
      expect(mockAdmin.rest.resources.Shop.all).toHaveBeenCalledWith({
        session: undefined
      });
    });

    it('should handle shop without primary domain', async () => {
      const mockShop = {
        data: [{
          id: 123,
          name: 'Test Shop',
          domain: 'test-shop.myshopify.com',
          primary_domain: null,
          email: 'test@test-shop.com'
        }]
      };
      
      mockAdmin.rest.resources.Shop.all.mockResolvedValue(mockShop);

      const result = await service.getShopInfo();

      expect(result).toEqual({
        id: 123,
        name: 'Test Shop',
        domain: 'test-shop.myshopify.com',
        primaryDomain: 'test-shop.myshopify.com',
        email: 'test@test-shop.com'
      });
    });

    it('should throw error if no shop found', async () => {
      const mockShop = { data: [] };
      
      mockAdmin.rest.resources.Shop.all.mockResolvedValue(mockShop);

      await expect(service.getShopInfo()).rejects.toThrow('Shop information not found');
    });
  });

  describe('getShopDomain', () => {
    it('should return shop domain', async () => {
      jest.spyOn(service, 'getShopInfo').mockResolvedValue({
        id: 123,
        name: 'Test Shop',
        domain: 'test-shop.myshopify.com',
        primaryDomain: 'test-shop.com',
        email: 'test@test-shop.com'
      });

      const result = await service.getShopDomain();

      expect(result).toBe('test-shop.com');
    });
  });

  describe('getHomepageUrl', () => {
    it('should return homepage URL with custom domain', async () => {
      jest.spyOn(service, 'getShopInfo').mockResolvedValue({
        id: 123,
        name: 'Test Shop',
        domain: 'test-shop.myshopify.com',
        primaryDomain: 'test-shop.com',
        email: 'test@test-shop.com'
      });

      const result = await service.getHomepageUrl();

      expect(result).toBe('https://test-shop.com');
    });

    it('should return homepage URL with myshopify domain', async () => {
      jest.spyOn(service, 'getShopInfo').mockResolvedValue({
        id: 123,
        name: 'Test Shop',
        domain: 'test-shop.myshopify.com',
        primaryDomain: 'test-shop.myshopify.com',
        email: 'test@test-shop.com'
      });

      const result = await service.getHomepageUrl();

      expect(result).toBe('https://test-shop.myshopify.com');
    });
  });
});