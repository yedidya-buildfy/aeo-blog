import { ShopifyThemeService } from './shopify-theme.service';
import { ShopifyShopService } from './shopify-shop.service';
import { GeminiService } from './gemini.service';
import { BackupService } from './backup.service';
import { UNIVERSAL_ROBOTS_TXT } from '../constants/aeo-templates';
import { Backup, AEOContent } from '@prisma/client';

export interface AEOResult {
  success: boolean;
  aeoContentId?: string;
  robotsUpdated?: boolean;
  llmsUpdated?: boolean;
  backups?: Backup[];
  error?: string;
}

export interface RestoreResult {
  success: boolean;
  robotsRestored?: boolean;
  llmsRestored?: boolean;
  error?: string;
}

export class AEOService {
  constructor(
    private themeService: ShopifyThemeService,
    private shopService: ShopifyShopService,
    private geminiService: GeminiService,
    private backupService: BackupService
  ) {}

  async previewAEO(): Promise<{
    success: boolean;
    generatedRobots: string;
    generatedLlms: string;
    homepageUrl: string;
    aeoContentId?: string;
    error?: string;
  }> {
    try {
      // 1. Get shop information and homepage URL
      const shopDomain = await this.shopService.getShopDomain();
      const homepageUrl = await this.shopService.getHomepageUrl();

      console.log(`Shop Domain: ${shopDomain}`);
      console.log(`Homepage URL: ${homepageUrl}`);

      // 2. Generate LLMS content using Gemini
      console.log(`Generating LLMS content for: ${homepageUrl}`);
      const generatedLlmsContent = await this.geminiService.generateLlmsContent(homepageUrl);

      console.log(`Generated LLMS content length: ${generatedLlmsContent.length}`);
      console.log(`Generated LLMS content preview: ${generatedLlmsContent.substring(0, 200)}...`);

      if (!generatedLlmsContent || generatedLlmsContent.trim().length === 0) {
        throw new Error('Gemini API returned empty LLMS content');
      }

      // 3. Save generated content to database
      console.log('Saving generated AEO content to database...');
      const aeoContent = await this.backupService.createAEOContent({
        shopDomain,
        sourceUrl: homepageUrl,
        llmsContent: generatedLlmsContent,
        robotsContent: UNIVERSAL_ROBOTS_TXT,
        status: 'generated'
      });

      console.log(`AEO content saved to database with ID: ${aeoContent.id}`);

      return {
        success: true,
        generatedRobots: UNIVERSAL_ROBOTS_TXT,
        generatedLlms: generatedLlmsContent,
        homepageUrl,
        aeoContentId: aeoContent.id,
      };

    } catch (error) {
      console.error('AEO preview failed:', error);

      return {
        success: false,
        generatedRobots: '',
        generatedLlms: '',
        homepageUrl: '',
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  async improveAEO(): Promise<AEOResult> {
    let aeoContentId: string | undefined;

    try {
      // 1. Get shop information
      const shopDomain = await this.shopService.getShopDomain();
      const homepageUrl = await this.shopService.getHomepageUrl();

      // 2. Get existing theme files
      const existingRobots = await this.themeService.getRobotsFile();
      const existingLlms = await this.themeService.getLlmsFile();

      // 3. Create backups
      const robotsBackup = await this.backupService.createBackup(
        shopDomain,
        'robots.txt.liquid',
        existingRobots
      );

      const llmsBackup = await this.backupService.createBackup(
        shopDomain,
        'llms.txt.liquid',
        existingLlms
      );

      // 4. Generate LLMS content using Gemini
      console.log(`Generating LLMS content for: ${homepageUrl}`);
      const generatedLlmsContent = await this.geminiService.generateLlmsContent(homepageUrl);

      // 5. Save generated content to database
      console.log('Saving generated AEO content to database...');
      const aeoContent = await this.backupService.createAEOContent({
        shopDomain,
        sourceUrl: homepageUrl,
        llmsContent: generatedLlmsContent,
        robotsContent: UNIVERSAL_ROBOTS_TXT,
        status: 'generated'
      });
      aeoContentId = aeoContent.id;

      // 6. Update theme files
      console.log('Updating robots.txt.liquid...');
      const robotsUpdated = await this.themeService.updateRobotsFile(UNIVERSAL_ROBOTS_TXT);
      if (!robotsUpdated) {
        throw new Error('Failed to update robots.txt.liquid');
      }

      console.log('Updating llms.txt.liquid...');
      const llmsUpdated = await this.themeService.updateLlmsFile(generatedLlmsContent);
      if (!llmsUpdated) {
        throw new Error('Failed to update llms.txt.liquid');
      }

      // 7. Update AEO content status to applied
      await this.backupService.updateAEOContentStatus(aeoContentId, 'applied');

      console.log('AEO improvement completed successfully!');

      return {
        success: true,
        aeoContentId,
        robotsUpdated,
        llmsUpdated,
        backups: [robotsBackup, llmsBackup],
      };

    } catch (error) {
      console.error('AEO improvement failed:', error);

      // Mark AEO content as failed if it was created
      if (aeoContentId) {
        await this.backupService.updateAEOContentStatus(aeoContentId, 'failed');
      }

      return {
        success: false,
        aeoContentId,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  async restoreBackup(): Promise<RestoreResult> {
    try {
      const shopDomain = await this.shopService.getShopDomain();

      // Get latest backups
      const robotsBackup = await this.backupService.getLatestBackup(shopDomain, 'robots.txt.liquid');
      const llmsBackup = await this.backupService.getLatestBackup(shopDomain, 'llms.txt.liquid');

      if (!robotsBackup && !llmsBackup) {
        return {
          success: false,
          error: 'No backups found to restore',
        };
      }

      let robotsRestored = false;
      let llmsRestored = false;

      // Restore robots.txt if backup exists
      if (robotsBackup && robotsBackup.content) {
        console.log('Restoring robots.txt.liquid from backup...');
        robotsRestored = await this.themeService.updateRobotsFile(robotsBackup.content);
      }

      // Restore llms.txt if backup exists  
      if (llmsBackup && llmsBackup.content) {
        console.log('Restoring llms.txt.liquid from backup...');
        llmsRestored = await this.themeService.updateLlmsFile(llmsBackup.content);
      }

      console.log('Restore completed successfully!');

      return {
        success: true,
        robotsRestored,
        llmsRestored,
      };

    } catch (error) {
      console.error('Restore failed:', error);

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  async getStatus(): Promise<{
    shopDomain: string;
    homepageUrl: string;
    currentRobots: string | null;
    currentLlms: string | null;
    lastAEOContent: AEOContent | null;
    backups: Backup[];
  }> {
    const shopDomain = await this.shopService.getShopDomain();
    const homepageUrl = await this.shopService.getHomepageUrl();
    const currentRobots = await this.themeService.getRobotsFile();
    const currentLlms = await this.themeService.getLlmsFile();
    const lastAEOContent = await this.backupService.getLatestAEOContent(shopDomain);
    const backups = await this.backupService.getAllBackups(shopDomain);

    return {
      shopDomain,
      homepageUrl,
      currentRobots,
      currentLlms,
      lastAEOContent,
      backups,
    };
  }
}