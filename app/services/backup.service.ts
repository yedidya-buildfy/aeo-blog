import { PrismaClient, Backup, AEOOperation } from '@prisma/client';

export class BackupService {
  constructor(private prisma: PrismaClient) {}

  async createBackup(shopDomain: string, fileName: string, content: string | null): Promise<Backup> {
    return await this.prisma.backup.create({
      data: {
        shopDomain,
        fileName,
        content,
      },
    });
  }

  async getLatestBackup(shopDomain: string, fileName: string): Promise<Backup | null> {
    return await this.prisma.backup.findFirst({
      where: {
        shopDomain,
        fileName,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async getAllBackups(shopDomain: string): Promise<Backup[]> {
    return await this.prisma.backup.findMany({
      where: {
        shopDomain,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async createOperation(shopDomain: string): Promise<AEOOperation> {
    return await this.prisma.aEOOperation.create({
      data: {
        shopDomain,
        status: 'in_progress',
      },
    });
  }

  async updateOperation(
    operationId: string, 
    status: 'success' | 'failed', 
    error?: string
  ): Promise<AEOOperation> {
    return await this.prisma.aEOOperation.update({
      where: { id: operationId },
      data: {
        status,
        error: status === 'failed' ? error : null,
      },
    });
  }

  async getLastOperation(shopDomain: string): Promise<AEOOperation | null> {
    return await this.prisma.aEOOperation.findFirst({
      where: {
        shopDomain,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}