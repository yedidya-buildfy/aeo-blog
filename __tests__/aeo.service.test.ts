import { AEOService } from '../app/services/aeo.service';
import { ShopifyThemeService } from '../app/services/shopify-theme.service';
import { ShopifyShopService } from '../app/services/shopify-shop.service';
import { GeminiService } from '../app/services/gemini.service';
import { BackupService } from '../app/services/backup.service';
import { PrismaClient } from '@prisma/client';

// Mock all dependencies
jest.mock('../app/services/shopify-theme.service');
jest.mock('../app/services/shopify-shop.service');
jest.mock('../app/services/gemini.service');
jest.mock('../app/services/backup.service');

const MockShopifyThemeService = ShopifyThemeService as jest.MockedClass<typeof ShopifyThemeService>;
const MockShopifyShopService = ShopifyShopService as jest.MockedClass<typeof ShopifyShopService>;
const MockGeminiService = GeminiService as jest.MockedClass<typeof GeminiService>;
const MockBackupService = BackupService as jest.MockedClass<typeof BackupService>;

describe('AEOService Integration', () => {
  let aeoService: AEOService;
  let mockAdmin: any;
  let mockPrisma: PrismaClient;

  let mockThemeService: jest.Mocked<ShopifyThemeService>;
  let mockShopService: jest.Mocked<ShopifyShopService>;
  let mockGeminiService: jest.Mocked<GeminiService>;
  let mockBackupService: jest.Mocked<BackupService>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock admin context
    mockAdmin = { session: { shop: 'test-shop.myshopify.com' } };
    mockPrisma = {} as PrismaClient;

    // Create mock instances
    mockThemeService = new MockShopifyThemeService(mockAdmin) as jest.Mocked<ShopifyThemeService>;
    mockShopService = new MockShopifyShopService(mockAdmin) as jest.Mocked<ShopifyShopService>;
    mockGeminiService = new MockGeminiService() as jest.Mocked<GeminiService>;
    mockBackupService = new MockBackupService(mockPrisma) as jest.Mocked<BackupService>;

    aeoService = new AEOService(
      mockThemeService,
      mockShopService,
      mockGeminiService,
      mockBackupService
    );
  });

  describe('improveAEO', () => {
    it('should complete full AEO improvement flow successfully', async () => {
      // Setup mocks for successful flow
      const shopDomain = 'test-shop.myshopify.com';
      const homepageUrl = 'https://test-shop.com';
      const existingRobots = 'old robots content';
      const existingLlms = 'old llms content';
      const generatedLlmsContent = `Test Store Brand
Your trusted online retailer

Core Pages:
- Homepage: https://test-shop.com
- FAQ: https://test-shop.com/pages/faq
- Contact: https://test-shop.com/pages/contact

Top Products:
1. Product 1 - https://test-shop.com/products/product-1
2. Product 2 - https://test-shop.com/products/product-2

Collections:
- All Products - https://test-shop.com/collections/all

Policies:
- Shipping Policy: https://test-shop.com/policies/shipping-policy
- Privacy Policy: https://test-shop.com/policies/privacy-policy

Q&A:
Q: What are your shipping options?
A: We offer free shipping on orders over $50.

Keywords: quality products, online shopping, fast shipping`;

      // Mock service calls
      mockShopService.getShopDomain.mockResolvedValue(shopDomain);
      mockShopService.getHomepageUrl.mockResolvedValue(homepageUrl);
      
      mockBackupService.createOperation.mockResolvedValue({
        id: 'op-123',
        shopDomain,
        status: 'in_progress',
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockThemeService.getRobotsFile.mockResolvedValue(existingRobots);
      mockThemeService.getLlmsFile.mockResolvedValue(existingLlms);

      mockBackupService.createBackup
        .mockResolvedValueOnce({
          id: 'backup-1',
          shopDomain,
          fileName: 'robots.txt.liquid',
          content: existingRobots,
          createdAt: new Date(),
        })
        .mockResolvedValueOnce({
          id: 'backup-2',
          shopDomain,
          fileName: 'llms.txt.liquid',
          content: existingLlms,
          createdAt: new Date(),
        });

      mockGeminiService.generateLlmsContent.mockResolvedValue(generatedLlmsContent);

      mockThemeService.updateRobotsFile.mockResolvedValue(true);
      mockThemeService.updateLlmsFile.mockResolvedValue(true);

      mockBackupService.updateOperation.mockResolvedValue({
        id: 'op-123',
        shopDomain,
        status: 'success',
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Execute the AEO improvement
      const result = await aeoService.improveAEO();

      // Verify the result
      expect(result.success).toBe(true);
      expect(result.operationId).toBe('op-123');
      expect(result.robotsUpdated).toBe(true);
      expect(result.llmsUpdated).toBe(true);
      expect(result.backups).toHaveLength(2);

      // Verify the flow sequence
      expect(mockShopService.getShopDomain).toHaveBeenCalled();
      expect(mockShopService.getHomepageUrl).toHaveBeenCalled();
      expect(mockBackupService.createOperation).toHaveBeenCalledWith(shopDomain);
      
      expect(mockThemeService.getRobotsFile).toHaveBeenCalled();
      expect(mockThemeService.getLlmsFile).toHaveBeenCalled();
      
      expect(mockBackupService.createBackup).toHaveBeenCalledWith(shopDomain, 'robots.txt.liquid', existingRobots);
      expect(mockBackupService.createBackup).toHaveBeenCalledWith(shopDomain, 'llms.txt.liquid', existingLlms);
      
      expect(mockGeminiService.generateLlmsContent).toHaveBeenCalledWith(homepageUrl);
      
      expect(mockThemeService.updateRobotsFile).toHaveBeenCalledWith(expect.stringContaining('User-agent: GPTBot'));
      expect(mockThemeService.updateLlmsFile).toHaveBeenCalledWith(generatedLlmsContent);
      
      expect(mockBackupService.updateOperation).toHaveBeenCalledWith('op-123', 'success');
    });

    it('should handle case where theme files do not exist', async () => {
      const shopDomain = 'test-shop.myshopify.com';
      const homepageUrl = 'https://test-shop.com';

      mockShopService.getShopDomain.mockResolvedValue(shopDomain);
      mockShopService.getHomepageUrl.mockResolvedValue(homepageUrl);
      
      mockBackupService.createOperation.mockResolvedValue({
        id: 'op-123',
        shopDomain,
        status: 'in_progress',
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Theme files don't exist
      mockThemeService.getRobotsFile.mockResolvedValue(null);
      mockThemeService.getLlmsFile.mockResolvedValue(null);

      mockBackupService.createBackup
        .mockResolvedValueOnce({
          id: 'backup-1',
          shopDomain,
          fileName: 'robots.txt.liquid',
          content: null,
          createdAt: new Date(),
        })
        .mockResolvedValueOnce({
          id: 'backup-2',
          shopDomain,
          fileName: 'llms.txt.liquid',
          content: null,
          createdAt: new Date(),
        });

      mockGeminiService.generateLlmsContent.mockResolvedValue('Generated content');
      mockThemeService.updateRobotsFile.mockResolvedValue(true);
      mockThemeService.updateLlmsFile.mockResolvedValue(true);

      mockBackupService.updateOperation.mockResolvedValue({
        id: 'op-123',
        shopDomain,
        status: 'success',
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await aeoService.improveAEO();

      expect(result.success).toBe(true);
      expect(mockBackupService.createBackup).toHaveBeenCalledWith(shopDomain, 'robots.txt.liquid', null);
      expect(mockBackupService.createBackup).toHaveBeenCalledWith(shopDomain, 'llms.txt.liquid', null);
    });

    it('should rollback on Gemini API failure', async () => {
      const shopDomain = 'test-shop.myshopify.com';
      const homepageUrl = 'https://test-shop.com';

      mockShopService.getShopDomain.mockResolvedValue(shopDomain);
      mockShopService.getHomepageUrl.mockResolvedValue(homepageUrl);
      
      mockBackupService.createOperation.mockResolvedValue({
        id: 'op-123',
        shopDomain,
        status: 'in_progress',
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockThemeService.getRobotsFile.mockResolvedValue('existing robots');
      mockThemeService.getLlmsFile.mockResolvedValue('existing llms');

      mockBackupService.createBackup.mockResolvedValue({} as any);

      // Gemini fails
      mockGeminiService.generateLlmsContent.mockRejectedValue(new Error('Gemini API error'));

      mockBackupService.updateOperation.mockResolvedValue({
        id: 'op-123',
        shopDomain,
        status: 'failed',
        error: 'Gemini API error',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await aeoService.improveAEO();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Gemini API error');
      expect(mockBackupService.updateOperation).toHaveBeenCalledWith('op-123', 'failed', expect.stringContaining('Gemini API error'));
      
      // Should not attempt to update theme files
      expect(mockThemeService.updateRobotsFile).not.toHaveBeenCalled();
      expect(mockThemeService.updateLlmsFile).not.toHaveBeenCalled();
    });

    it('should rollback on theme update failure', async () => {
      const shopDomain = 'test-shop.myshopify.com';
      const homepageUrl = 'https://test-shop.com';

      mockShopService.getShopDomain.mockResolvedValue(shopDomain);
      mockShopService.getHomepageUrl.mockResolvedValue(homepageUrl);
      
      mockBackupService.createOperation.mockResolvedValue({
        id: 'op-123',
        shopDomain,
        status: 'in_progress',
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockThemeService.getRobotsFile.mockResolvedValue('existing robots');
      mockThemeService.getLlmsFile.mockResolvedValue('existing llms');
      mockBackupService.createBackup.mockResolvedValue({} as any);
      mockGeminiService.generateLlmsContent.mockResolvedValue('generated content');

      // Theme update fails
      mockThemeService.updateRobotsFile.mockResolvedValue(false);

      const result = await aeoService.improveAEO();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to update robots.txt');
      expect(mockBackupService.updateOperation).toHaveBeenCalledWith('op-123', 'failed', expect.stringContaining('Failed to update robots.txt'));
    });
  });

  describe('restoreBackup', () => {
    it('should restore both files from backups', async () => {
      const shopDomain = 'test-shop.myshopify.com';
      
      mockShopService.getShopDomain.mockResolvedValue(shopDomain);

      mockBackupService.getLatestBackup
        .mockResolvedValueOnce({
          id: 'backup-1',
          shopDomain,
          fileName: 'robots.txt.liquid',
          content: 'original robots content',
          createdAt: new Date(),
        })
        .mockResolvedValueOnce({
          id: 'backup-2',
          shopDomain,
          fileName: 'llms.txt.liquid',
          content: 'original llms content',
          createdAt: new Date(),
        });

      mockThemeService.updateRobotsFile.mockResolvedValue(true);
      mockThemeService.updateLlmsFile.mockResolvedValue(true);

      const result = await aeoService.restoreBackup();

      expect(result.success).toBe(true);
      expect(result.robotsRestored).toBe(true);
      expect(result.llmsRestored).toBe(true);
      
      expect(mockThemeService.updateRobotsFile).toHaveBeenCalledWith('original robots content');
      expect(mockThemeService.updateLlmsFile).toHaveBeenCalledWith('original llms content');
    });

    it('should handle missing backups gracefully', async () => {
      const shopDomain = 'test-shop.myshopify.com';
      
      mockShopService.getShopDomain.mockResolvedValue(shopDomain);

      // No backups found
      mockBackupService.getLatestBackup.mockResolvedValue(null);

      const result = await aeoService.restoreBackup();

      expect(result.success).toBe(false);
      expect(result.error).toContain('No backups found');
      expect(mockThemeService.updateRobotsFile).not.toHaveBeenCalled();
      expect(mockThemeService.updateLlmsFile).not.toHaveBeenCalled();
    });
  });
});