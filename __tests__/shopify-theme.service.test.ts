import { ShopifyThemeService } from '../app/services/shopify-theme.service';

// Mock the authenticate function
const mockGraphQL = jest.fn();
const mockAdmin = {
  graphql: mockGraphQL,
  rest: {
    resources: {
      Theme: {
        all: jest.fn(),
      },
      Asset: {
        all: jest.fn(),
        save: jest.fn(),
      }
    }
  }
};

describe('ShopifyThemeService', () => {
  let service: ShopifyThemeService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ShopifyThemeService(mockAdmin as any);
  });

  describe('getPublishedThemeId', () => {
    it('should return the published theme ID', async () => {
      const mockThemes = {
        data: [
          { id: 123, role: 'unpublished' },
          { id: 456, role: 'main' }
        ]
      };
      
      mockAdmin.rest.resources.Theme.all.mockResolvedValue(mockThemes);

      const result = await service.getPublishedThemeId();

      expect(result).toBe(456);
      expect(mockAdmin.rest.resources.Theme.all).toHaveBeenCalledWith({ 
        session: undefined 
      });
    });

    it('should throw error if no published theme found', async () => {
      const mockThemes = {
        data: [
          { id: 123, role: 'unpublished' }
        ]
      };
      
      mockAdmin.rest.resources.Theme.all.mockResolvedValue(mockThemes);

      await expect(service.getPublishedThemeId()).rejects.toThrow('No published theme found');
    });
  });

  describe('getAsset', () => {
    it('should retrieve a theme asset', async () => {
      const mockAsset = {
        data: [{
          key: 'templates/robots.txt.liquid',
          value: 'robots content'
        }]
      };
      
      mockAdmin.rest.resources.Asset.all.mockResolvedValue(mockAsset);

      const result = await service.getAsset(456, 'templates/robots.txt.liquid');

      expect(result).toEqual({
        key: 'templates/robots.txt.liquid',
        value: 'robots content'
      });
      expect(mockAdmin.rest.resources.Asset.all).toHaveBeenCalledWith({
        session: undefined,
        theme_id: 456,
        'asset[key]': 'templates/robots.txt.liquid'
      });
    });

    it('should return null if asset not found', async () => {
      const mockAsset = { data: [] };
      
      mockAdmin.rest.resources.Asset.all.mockResolvedValue(mockAsset);

      const result = await service.getAsset(456, 'templates/nonexistent.liquid');

      expect(result).toBeNull();
    });
  });

  describe('updateAsset', () => {
    it('should update a theme asset', async () => {
      const mockSaveResult = { 
        success: true,
        asset: {
          key: 'templates/robots.txt.liquid',
          value: 'new content'
        }
      };
      
      mockAdmin.rest.resources.Asset.save.mockResolvedValue(mockSaveResult);

      const result = await service.updateAsset(456, 'templates/robots.txt.liquid', 'new content');

      expect(result).toBe(true);
      expect(mockAdmin.rest.resources.Asset.save).toHaveBeenCalledWith({
        session: undefined,
        theme_id: 456,
        key: 'templates/robots.txt.liquid',
        value: 'new content'
      });
    });

    it('should return false if update fails', async () => {
      mockAdmin.rest.resources.Asset.save.mockRejectedValue(new Error('Update failed'));

      const result = await service.updateAsset(456, 'templates/robots.txt.liquid', 'new content');

      expect(result).toBe(false);
    });
  });

  describe('getRobotsFile', () => {
    it('should get robots.txt.liquid file', async () => {
      jest.spyOn(service, 'getPublishedThemeId').mockResolvedValue(456);
      jest.spyOn(service, 'getAsset').mockResolvedValue({
        key: 'templates/robots.txt.liquid',
        value: 'robots content'
      });

      const result = await service.getRobotsFile();

      expect(result).toBe('robots content');
      expect(service.getAsset).toHaveBeenCalledWith(456, 'templates/robots.txt.liquid');
    });
  });

  describe('updateRobotsFile', () => {
    it('should update robots.txt.liquid file', async () => {
      jest.spyOn(service, 'getPublishedThemeId').mockResolvedValue(456);
      jest.spyOn(service, 'updateAsset').mockResolvedValue(true);

      const result = await service.updateRobotsFile('new robots content');

      expect(result).toBe(true);
      expect(service.updateAsset).toHaveBeenCalledWith(456, 'templates/robots.txt.liquid', 'new robots content');
    });
  });

  describe('getLlmsFile', () => {
    it('should get llms.txt.liquid file', async () => {
      jest.spyOn(service, 'getPublishedThemeId').mockResolvedValue(456);
      jest.spyOn(service, 'getAsset').mockResolvedValue({
        key: 'templates/llms.txt.liquid',
        value: 'llms content'
      });

      const result = await service.getLlmsFile();

      expect(result).toBe('llms content');
      expect(service.getAsset).toHaveBeenCalledWith(456, 'templates/llms.txt.liquid');
    });
  });

  describe('updateLlmsFile', () => {
    it('should update llms.txt.liquid file', async () => {
      jest.spyOn(service, 'getPublishedThemeId').mockResolvedValue(456);
      jest.spyOn(service, 'updateAsset').mockResolvedValue(true);

      const result = await service.updateLlmsFile('llms content');

      expect(result).toBe(true);
      expect(service.updateAsset).toHaveBeenCalledWith(456, 'templates/llms.txt.liquid', '{% layout none %}\nllms content');
    });

    it('should not add layout none if already present', async () => {
      jest.spyOn(service, 'getPublishedThemeId').mockResolvedValue(456);
      jest.spyOn(service, 'updateAsset').mockResolvedValue(true);

      const result = await service.updateLlmsFile('{% layout none %}\nllms content');

      expect(result).toBe(true);
      expect(service.updateAsset).toHaveBeenCalledWith(456, 'templates/llms.txt.liquid', '{% layout none %}\nllms content');
    });
  });
});