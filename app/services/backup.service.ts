import { PrismaClient, Backup, AEOContent } from '@prisma/client';

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

  async createAEOContent(data: {
    shopDomain: string;
    sourceUrl: string;
    llmsContent: string;
    status: string;
  }): Promise<AEOContent> {
    // Get the next version number for this shop
    const latestContent = await this.getLatestAEOContent(data.shopDomain);
    const version = latestContent ? latestContent.version + 1 : 1;

    return await this.prisma.aEOContent.create({
      data: {
        ...data,
        version,
      },
    });
  }

  async getLatestAEOContent(shopDomain: string): Promise<AEOContent | null> {
    return await this.prisma.aEOContent.findFirst({
      where: {
        shopDomain,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async getAllAEOContent(shopDomain: string): Promise<AEOContent[]> {
    return await this.prisma.aEOContent.findMany({
      where: {
        shopDomain,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async updateAEOContentStatus(
    id: string,
    status: string
  ): Promise<AEOContent> {
    return await this.prisma.aEOContent.update({
      where: { id },
      data: {
        status,
      },
    });
  }
}