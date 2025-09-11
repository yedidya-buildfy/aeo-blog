import { BackupService } from '../app/services/backup.service';
import { PrismaClient } from '@prisma/client';

// Mock Prisma Client
const mockPrisma = {
  backup: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    delete: jest.fn(),
  },
  aEOOperation: {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
} as any;

describe('BackupService', () => {
  let service: BackupService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BackupService(mockPrisma);
  });

  describe('createBackup', () => {
    it('should create a backup for robots.txt file', async () => {
      const mockBackup = {
        id: 'backup-1',
        shopDomain: 'test-shop.myshopify.com',
        fileName: 'robots.txt.liquid',
        content: 'robots content',
        createdAt: new Date(),
      };

      mockPrisma.backup.create.mockResolvedValue(mockBackup);

      const result = await service.createBackup(
        'test-shop.myshopify.com',
        'robots.txt.liquid',
        'robots content'
      );

      expect(result).toEqual(mockBackup);
      expect(mockPrisma.backup.create).toHaveBeenCalledWith({
        data: {
          shopDomain: 'test-shop.myshopify.com',
          fileName: 'robots.txt.liquid',
          content: 'robots content',
        },
      });
    });

    it('should create a backup for llms.txt file', async () => {
      const mockBackup = {
        id: 'backup-2',
        shopDomain: 'test-shop.myshopify.com',
        fileName: 'llms.txt.liquid',
        content: 'llms content',
        createdAt: new Date(),
      };

      mockPrisma.backup.create.mockResolvedValue(mockBackup);

      const result = await service.createBackup(
        'test-shop.myshopify.com',
        'llms.txt.liquid',
        'llms content'
      );

      expect(result).toEqual(mockBackup);
    });

    it('should handle null content', async () => {
      const mockBackup = {
        id: 'backup-3',
        shopDomain: 'test-shop.myshopify.com',
        fileName: 'robots.txt.liquid',
        content: null,
        createdAt: new Date(),
      };

      mockPrisma.backup.create.mockResolvedValue(mockBackup);

      const result = await service.createBackup(
        'test-shop.myshopify.com',
        'robots.txt.liquid',
        null
      );

      expect(result).toEqual(mockBackup);
      expect(mockPrisma.backup.create).toHaveBeenCalledWith({
        data: {
          shopDomain: 'test-shop.myshopify.com',
          fileName: 'robots.txt.liquid',
          content: null,
        },
      });
    });
  });

  describe('getLatestBackup', () => {
    it('should retrieve the latest backup for a file', async () => {
      const mockBackup = {
        id: 'backup-1',
        shopDomain: 'test-shop.myshopify.com',
        fileName: 'robots.txt.liquid',
        content: 'robots content',
        createdAt: new Date(),
      };

      mockPrisma.backup.findFirst.mockResolvedValue(mockBackup);

      const result = await service.getLatestBackup('test-shop.myshopify.com', 'robots.txt.liquid');

      expect(result).toEqual(mockBackup);
      expect(mockPrisma.backup.findFirst).toHaveBeenCalledWith({
        where: {
          shopDomain: 'test-shop.myshopify.com',
          fileName: 'robots.txt.liquid',
        },
        orderBy: {
          createdAt: 'desc',
        },
      });
    });

    it('should return null if no backup found', async () => {
      mockPrisma.backup.findFirst.mockResolvedValue(null);

      const result = await service.getLatestBackup('test-shop.myshopify.com', 'nonexistent.liquid');

      expect(result).toBeNull();
    });
  });

  describe('getAllBackups', () => {
    it('should retrieve all backups for a shop', async () => {
      const mockBackups = [
        {
          id: 'backup-1',
          shopDomain: 'test-shop.myshopify.com',
          fileName: 'robots.txt.liquid',
          content: 'robots content',
          createdAt: new Date('2023-01-02'),
        },
        {
          id: 'backup-2',
          shopDomain: 'test-shop.myshopify.com',
          fileName: 'llms.txt.liquid',
          content: 'llms content',
          createdAt: new Date('2023-01-01'),
        },
      ];

      mockPrisma.backup.findMany.mockResolvedValue(mockBackups);

      const result = await service.getAllBackups('test-shop.myshopify.com');

      expect(result).toEqual(mockBackups);
      expect(mockPrisma.backup.findMany).toHaveBeenCalledWith({
        where: {
          shopDomain: 'test-shop.myshopify.com',
        },
        orderBy: {
          createdAt: 'desc',
        },
      });
    });
  });

  describe('createOperation', () => {
    it('should create an AEO operation record', async () => {
      const mockOperation = {
        id: 'op-1',
        shopDomain: 'test-shop.myshopify.com',
        status: 'in_progress',
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.aEOOperation.create.mockResolvedValue(mockOperation);

      const result = await service.createOperation('test-shop.myshopify.com');

      expect(result).toEqual(mockOperation);
      expect(mockPrisma.aEOOperation.create).toHaveBeenCalledWith({
        data: {
          shopDomain: 'test-shop.myshopify.com',
          status: 'in_progress',
        },
      });
    });
  });

  describe('updateOperation', () => {
    it('should update an operation to success', async () => {
      const mockUpdatedOperation = {
        id: 'op-1',
        shopDomain: 'test-shop.myshopify.com',
        status: 'success',
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.aEOOperation.update.mockResolvedValue(mockUpdatedOperation);

      const result = await service.updateOperation('op-1', 'success');

      expect(result).toEqual(mockUpdatedOperation);
      expect(mockPrisma.aEOOperation.update).toHaveBeenCalledWith({
        where: { id: 'op-1' },
        data: {
          status: 'success',
          error: null,
        },
      });
    });

    it('should update an operation to failed with error', async () => {
      const mockUpdatedOperation = {
        id: 'op-1',
        shopDomain: 'test-shop.myshopify.com',
        status: 'failed',
        error: 'API error occurred',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.aEOOperation.update.mockResolvedValue(mockUpdatedOperation);

      const result = await service.updateOperation('op-1', 'failed', 'API error occurred');

      expect(result).toEqual(mockUpdatedOperation);
      expect(mockPrisma.aEOOperation.update).toHaveBeenCalledWith({
        where: { id: 'op-1' },
        data: {
          status: 'failed',
          error: 'API error occurred',
        },
      });
    });
  });

  describe('getLastOperation', () => {
    it('should retrieve the last operation for a shop', async () => {
      const mockOperation = {
        id: 'op-1',
        shopDomain: 'test-shop.myshopify.com',
        status: 'success',
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.aEOOperation.findFirst.mockResolvedValue(mockOperation);

      const result = await service.getLastOperation('test-shop.myshopify.com');

      expect(result).toEqual(mockOperation);
      expect(mockPrisma.aEOOperation.findFirst).toHaveBeenCalledWith({
        where: {
          shopDomain: 'test-shop.myshopify.com',
        },
        orderBy: {
          createdAt: 'desc',
        },
      });
    });
  });
});