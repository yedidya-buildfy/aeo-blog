import { useEffect, useState, useRef } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useRevalidator } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  InlineStack,
  Badge,
  Banner,
  Spinner,
  Divider,
  TextField,
  DataTable,
  List,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { AEOService } from "../services/aeo.service";
import { ShopifyThemeService } from "../services/shopify-theme.service";
import { ShopifyShopService } from "../services/shopify-shop.service";
import { GeminiService } from "../services/gemini.service";
import { BackupService } from "../services/backup.service";
import { checkAutomation } from "../services/automation-middleware.service";
import { AutomationSchedulerService } from "../services/automation-scheduler.service";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { admin } = await authenticate.admin(request);

    // GraphQL authentication successful

    // Initialize services directly in the loader
    const themeService = new ShopifyThemeService(admin);
    const shopService = new ShopifyShopService(admin);
    const geminiService = new GeminiService();
    const backupService = new BackupService(prisma);

    // Get shop info and check automation asynchronously
    const shopInfo = await shopService.getShopInfo();
    checkAutomation(shopInfo.primaryDomain || 'unknown', admin);

    const aeoService = new AEOService(
      themeService,
      shopService,
      geminiService,
      backupService
    );

    // Get AEO status
    const status = await aeoService.getStatus();

    // Calculate KPI metrics - temporarily disable BlogPost queries due to schema issues
    const shopDomain = shopInfo.primaryDomain || 'unknown';

    // TODO: Re-enable BlogPost queries once database schema is fixed
    // For now, use default values to prevent authentication errors
    const totalBlogs = 0;
    const weeksActive = 1;

    // Calculate metrics
    const kpiMetrics = {
      totalBlogs,
      aiSessions: 103 * weeksActive,
      timeSavedMinutes: totalBlogs * 43,
      timeSavedHours: Math.round((totalBlogs * 43) / 60 * 10) / 10, // Round to 1 decimal
      weeksActive
    };

    return json({
      status,
      kpiMetrics,
      error: null
    });
  } catch (error) {
    console.error('Error in loader:', error);

    // Return default state for authentication issues
    return json({
      status: {
        shopDomain: 'Authenticating...',
        homepageUrl: '',
        currentRobots: null,
        currentLlms: null,
        lastAEOContent: null,
        backups: [],
      },
      kpiMetrics: {
        totalBlogs: 0,
        aiSessions: 0,
        timeSavedMinutes: 0,
        timeSavedHours: 0,
        weeksActive: 0
      },
      error: 'Authentication failed'
    });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const actionType = formData.get('actionType');

  try {
    const { admin } = await authenticate.admin(request);

    // Initialize services directly in the action
    const themeService = new ShopifyThemeService(admin);
    const shopService = new ShopifyShopService(admin);
    const geminiService = new GeminiService();
    const backupService = new BackupService(prisma);

    const aeoService = new AEOService(
      themeService,
      shopService,
      geminiService,
      backupService
    );

    if (actionType === 'improve') {
      console.log("Starting improved AEO process...");

      // 1. First generate the content like preview
      const previewResult = await aeoService.previewAEO();
      if (!previewResult.success) {
        return json({ success: false, error: previewResult.error });
      }

      // 2. Check existing files and create if missing
      const existingRobots = await themeService.getRobotsFile();
      const existingLlms = await themeService.getLlmsFile();

      const filesToCreate = [];
      if (!existingRobots) {
        filesToCreate.push({
          filename: 'robots.txt.liquid',
          content: previewResult.generatedRobots
        });
      }
      if (!existingLlms) {
        filesToCreate.push({
          filename: 'llms.txt.liquid',
          content: previewResult.generatedLlms
        });
      }

      // 3. Create missing files first
      if (filesToCreate.length > 0) {
        const createResult = await themeService.createMultipleTemplateFiles(filesToCreate);
        if (!createResult) {
          return json({ success: false, error: 'Failed to create missing files' });
        }
      }

      // 4. Now update both files with generated content
      console.log('Updating robots.txt.liquid with generated content...');
      const robotsUpdated = await themeService.updateRobotsFile(previewResult.generatedRobots);
      if (!robotsUpdated) {
        return json({ success: false, error: 'Failed to update robots.txt.liquid' });
      }

      console.log('Updating llms.txt.liquid with generated content...');
      const llmsUpdated = await themeService.updateLlmsFile(previewResult.generatedLlms);
      if (!llmsUpdated) {
        return json({ success: false, error: 'Failed to update llms.txt.liquid' });
      }

      console.log("AEO improvement completed successfully!");

      return json({
        success: true,
        message: 'AEO files created and updated successfully',
        generatedRobots: previewResult.generatedRobots,
        generatedLlms: previewResult.generatedLlms,
        homepageUrl: previewResult.homepageUrl,
        robotsUpdated,
        llmsUpdated
      });
    } else if (actionType === 'restore') {
      console.log("Starting backup restore...");
      const result = await aeoService.restoreBackup();

      if (result.success) {
        console.log("Backup restore completed successfully");
      } else {
        console.log("Backup restore failed:", result.error);
      }

      return json(result);
    } else if (actionType === 'updateFile') {
      console.log("Starting file update...");
      const fileType = formData.get('fileType') as string;
      const content = formData.get('content') as string;

      if (!fileType || !content) {
        return json({ success: false, error: 'Missing file type or content' }, { status: 400 });
      }

      const shopDomain = await shopService.getShopDomain();

      // 1. Create backup before making changes (following same logic as improve AEO flow)
      const existingContent = fileType === 'robots'
        ? await themeService.getRobotsFile()
        : await themeService.getLlmsFile();

      if (existingContent) {
        const filename = fileType === 'robots' ? 'robots.txt.liquid' : 'llms.txt.liquid';
        await backupService.createBackup(shopDomain, filename, existingContent);
        console.log(`Created backup for ${filename} before manual update`);
      }

      // 2. Get or create AEOContent record
      let aeoContent = await prisma.aEOContent.findFirst({
        where: { shopDomain },
        orderBy: { createdAt: 'desc' }
      });

      if (!aeoContent) {
        // Get homepage URL for new record
        const homepageUrl = await shopService.getHomepageUrl();

        // Create new record if doesn't exist
        aeoContent = await prisma.aEOContent.create({
          data: {
            shopDomain,
            sourceUrl: homepageUrl,
            llmsContent: '',
            robotsContent: '',
            status: 'active'
          }
        });
      }

      // 3. Update the appropriate field and Shopify theme file (same logic as improve AEO)
      if (fileType === 'robots') {
        // Update database first
        await prisma.aEOContent.update({
          where: { id: aeoContent.id },
          data: {
            robotsContent: content,
            version: aeoContent.version + 1,
            updatedAt: new Date()
          }
        });

        // Update theme file using same service method as improve AEO flow
        console.log('Updating robots.txt.liquid with user content...');
        const robotsUpdated = await themeService.updateRobotsFile(content);
        if (!robotsUpdated) {
          return json({ success: false, error: 'Failed to update robots.txt in theme' });
        }
      } else if (fileType === 'llms') {
        // Update database first
        await prisma.aEOContent.update({
          where: { id: aeoContent.id },
          data: {
            llmsContent: content,
            version: aeoContent.version + 1,
            updatedAt: new Date()
          }
        });

        // Update theme file using same service method as improve AEO flow
        console.log('Updating llms.txt.liquid with user content...');
        const llmsUpdated = await themeService.updateLlmsFile(content);
        if (!llmsUpdated) {
          return json({ success: false, error: 'Failed to update llms.txt in theme' });
        }
      } else {
        return json({ success: false, error: 'Invalid file type' }, { status: 400 });
      }

      console.log(`Successfully updated ${fileType}.txt in both database and theme`);
      return json({ success: true, message: `${fileType}.txt updated successfully` });
    } else if (actionType === 'enableAutomation') {
      const shopInfo = await shopService.getShopInfo();
      const shopDomain = shopInfo.primaryDomain || 'unknown';

      const automationService = new AutomationSchedulerService(prisma);
      await automationService.enableAutomation(shopDomain, 0, 10); // Sunday, 10 AM

      return json({
        success: true,
        message: 'Weekly automation enabled! Blogs will be posted every Sunday at 10 AM Israel time.'
      });
    } else if (actionType === 'disableAutomation') {
      const shopInfo = await shopService.getShopInfo();
      const shopDomain = shopInfo.primaryDomain || 'unknown';

      const automationService = new AutomationSchedulerService(prisma);
      await automationService.disableAutomation(shopDomain);

      return json({
        success: true,
        message: 'Weekly automation disabled.'
      });
    } else {
      return json({ success: false, error: 'Invalid action type' }, { status: 400 });
    }
  } catch (error) {
    console.error('Error in action:', error);
    
    // If authentication fails, return a more specific error
    return json(
      {
        success: false,
        error: "Authentication failed. Please refresh the page and try again.",
      },
      { status: 401 }
    );
  }
};

interface KeywordData {
  mainProducts: string[];
  problemsSolved: string[];
  customerSearches: string[];
}

export default function AEODashboard() {
  const { status: initialStatus, kpiMetrics, error: loaderError } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();

  const [status, setStatus] = useState(initialStatus);
  const [selectedFile, setSelectedFile] = useState<'robots' | 'llms' | null>(null);
  const [editMode, setEditMode] = useState<'robots' | 'llms' | null>(null);
  const [editContent, setEditContent] = useState<string>('');
  const [hasChanges, setHasChanges] = useState(false);
  const fileContentRef = useRef<HTMLDivElement>(null);

  // Remove unused SEO blog generation state variables
  
  const isLoading = fetcher.state === "submitting";
  const actionData = fetcher.data;

  // Update status when loader data changes
  useEffect(() => {
    if (initialStatus) {
      setStatus(initialStatus);
    }
  }, [initialStatus]);

  // Handle action completion
  useEffect(() => {
    if (actionData) {
      if (actionData.success) {
        const actionType = fetcher.formData?.get('actionType');
        let message = "Operation completed successfully!";
        
        if (actionType === 'improve') {
          message = actionData.message || "AEO improvement completed successfully!";
        } else if (actionType === 'restore') {
          message = "Backup restored successfully!";
        }
        
        shopify.toast.show(message);
        
        // Refresh to show updated file status in sidebar
        revalidator.revalidate();
      } else {
        shopify.toast.show(`Error: ${actionData.error}`, { isError: true });
      }
    }
  }, [actionData, shopify, revalidator, fetcher.formData]);

  const handleRestoreBackup = () => {
    const formData = new FormData();
    formData.append('actionType', 'restore');
    fetcher.submit(formData, { method: 'POST' });
  };

  const handleImproveAEO = () => {
    const formData = new FormData();
    formData.append('actionType', 'improve');
    fetcher.submit(formData, { method: 'POST' });
  };

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const handleFileToggle = (file: 'robots' | 'llms') => {
    setSelectedFile(selectedFile === file ? null : file);
  };

  const handleEdit = (file: 'robots' | 'llms') => {
    setEditMode(file);
    setEditContent(file === 'robots' ? status?.currentRobots || '' : status?.currentLlms || '');
    setHasChanges(false);
  };

  const handleSave = () => {
    const formData = new FormData();
    formData.append('actionType', 'updateFile');
    formData.append('fileType', editMode!);
    formData.append('content', editContent);
    fetcher.submit(formData, { method: 'POST' });
    setEditMode(null);
    setHasChanges(false);
  };

  const handleCancel = () => {
    setEditMode(null);
    setEditContent('');
    setHasChanges(false);
  };

  // SEO Blog Generation Functions
  // Remove unused keyword generation and blog functions

  // Handle clicks outside the file content area
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (selectedFile && fileContentRef.current && !fileContentRef.current.contains(event.target as Node)) {
        // Check if the click was not on the toggle buttons
        const target = event.target as HTMLElement;
        const isButtonClick = target.closest('button') || target.closest('[role="button"]');
        if (!isButtonClick) {
          setSelectedFile(null);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [selectedFile]);

  const getStatusBadge = (operationStatus: string) => {
    switch (operationStatus) {
      case 'success':
        return <Badge status="success">Success</Badge>;
      case 'failed':
        return <Badge status="critical">Failed</Badge>;
      case 'in_progress':
        return <Badge status="info">In Progress</Badge>;
      default:
        return <Badge>Unknown</Badge>;
    }
  };

  const getSmartStatusBadge = () => {
    const hasRobots = status?.currentRobots && status.currentRobots.trim().length > 0;
    const hasLlms = status?.currentLlms && status.currentLlms.trim().length > 0;

    if (!hasRobots && !hasLlms) {
      return <Badge tone="critical">Empty</Badge>;
    } else if (hasRobots && hasLlms) {
      return <Badge tone="success">Working</Badge>;
    } else {
      return <Badge tone="warning">In Progress</Badge>;
    }
  };

  // Show loading state while authenticating
  if (loaderError === 'Failed to fetch status' && (!status || status.shopDomain === 'Authenticating...')) {
    return (
      <Page>
        <TitleBar title="AEO One-Click (Gemini Direct)" />
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400" align="center">
                <Spinner size="large" />
                <Text as="h2" variant="headingMd" alignment="center">
                  Authenticating with Shopify...
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
                  Please wait while we establish a secure connection.
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  // Show error for actual errors
  if (loaderError && loaderError !== 'Failed to fetch status') {
    return (
      <Page>
        <TitleBar title="AEO One-Click" />
        <Banner status="critical">
          <p>Error loading dashboard: {loaderError}</p>
        </Banner>
      </Page>
    );
  }

  return (
    <Page>
      <TitleBar title="AEO One-Click (Gemini Direct)" />

      <BlockStack gap="500">
        {/* KPI Metrics Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
          <Card>
            <div style={{ padding: '1.5rem', textAlign: 'center' }}>
              <Text as="h3" variant="headingMd" fontWeight="medium">Blogs Generated</Text>
              <div style={{ margin: '1rem 0' }}>
                <Text as="p" variant="heading3xl" fontWeight="bold">{kpiMetrics?.totalBlogs || 0}</Text>
              </div>
              <Text as="p" variant="bodyMd" tone="subdued">Total blogs created</Text>
            </div>
          </Card>
          <Card>
            <div style={{ padding: '1.5rem', textAlign: 'center' }}>
              <Text as="h3" variant="headingMd" fontWeight="medium">AI Sessions</Text>
              <div style={{ margin: '1rem 0' }}>
                <Text as="p" variant="heading3xl" fontWeight="bold">{kpiMetrics?.aiSessions || 0}</Text>
              </div>
              <Text as="p" variant="bodyMd" tone="subdued">Estimated AI interactions</Text>
            </div>
          </Card>
          <Card>
            <div style={{ padding: '1.5rem', textAlign: 'center' }}>
              <Text as="h3" variant="headingMd" fontWeight="medium">Time Saved</Text>
              <div style={{ margin: '1rem 0' }}>
                <Text as="p" variant="heading3xl" fontWeight="bold">{kpiMetrics?.timeSavedHours || 0}h</Text>
              </div>
              <Text as="p" variant="bodyMd" tone="subdued">Hours saved with automation</Text>
            </div>
          </Card>
        </div>

        {/* Main Action Card */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="200">
                  <Text as="h2" variant="headingLg">
                    AI Engine Optimization
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    One-click AEO optimization for your store. This will generate robots.txt and llms.txt files using Gemini AI and automatically apply them to your theme.
                  </Text>
                </BlockStack>

                <InlineStack gap="300">
                  <Button
                    variant="primary"
                    size="large"
                    onClick={handleImproveAEO}
                    loading={isLoading && fetcher.formData?.get('actionType') === 'improve'}
                  >
                    {isLoading && fetcher.formData?.get('actionType') === 'improve'
                      ? 'Improving AEO...'
                      : 'Improve My AEO'
                    }
                  </Button>

                  {status?.backups && status.backups.length > 0 && (
                    <Button
                      onClick={handleRestoreBackup}
                      loading={isLoading && fetcher.formData?.get('actionType') === 'restore'}
                    >
                      {isLoading && fetcher.formData?.get('actionType') === 'restore'
                        ? 'Restoring...'
                        : 'Restore Backup'
                      }
                    </Button>
                  )}
                </InlineStack>

                {/* File Toggle Buttons */}
                <BlockStack gap="300">
                  <Text as="p" variant="bodyMd" tone="subdued">
                    View current theme files:
                  </Text>
                  <InlineStack gap="300">
                    <Button
                      pressed={selectedFile === 'robots'}
                      onClick={() => handleFileToggle('robots')}
                      size="medium"
                    >
                      🤖 robots.txt
                    </Button>
                    <Button
                      pressed={selectedFile === 'llms'}
                      onClick={() => handleFileToggle('llms')}
                      size="medium"
                    >
                      📄 llms.txt
                    </Button>
                  </InlineStack>
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Status Info Sidebar */}
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <Text as="h3" variant="headingMd">
                  Status Info
                </Text>

                {/* Last AEO Generation Section */}
                <BlockStack gap="300">
                  <Text as="h4" variant="headingSm">
                    Last AEO Generation
                  </Text>
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd">Status</Text>
                      {getSmartStatusBadge()}
                    </InlineStack>
                    {status?.lastAEOContent && (
                      <Text as="p" variant="bodySm" tone="subdued">
                        Version {status.lastAEOContent.version} - {formatDateTime(status.lastAEOContent.createdAt)}
                      </Text>
                    )}
                  </BlockStack>
                </BlockStack>

                {/* Homepage Section */}
                <BlockStack gap="300">
                  <Text as="h4" variant="headingSm">
                    Homepage
                  </Text>
                  <BlockStack gap="200">
                    <Text as="p" variant="bodyMd">
                      {status?.homepageUrl ? (
                        <a href={status.homepageUrl} target="_blank" rel="noopener noreferrer">
                          {status.homepageUrl}
                        </a>
                      ) : (
                        'Loading...'
                      )}
                    </Text>
                  </BlockStack>
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>

      <BlockStack gap="500">
        {/* Applied Files Section */}
        {actionData && actionData.success && 'generatedRobots' in actionData && 'generatedLlms' in actionData && fetcher.formData?.get('actionType') === 'improve' && (
          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingLg">
                    Applied AEO Files
                  </Text>
                  <Text as="p" variant="bodyMd" tone="success">
                    Files successfully applied to your theme for: {'homepageUrl' in actionData ? actionData.homepageUrl : 'your store'}
                  </Text>
                  
                  <Divider />
                  
                  <BlockStack gap="400">
                    {/* Robots.txt Preview */}
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingMd">
                        robots.txt.liquid
                      </Text>
                      <Card background="bg-surface-secondary">
                        <pre style={{ 
                          whiteSpace: 'pre-wrap',
                          margin: 0,
                          fontSize: '12px',
                          fontFamily: 'Monaco, "Lucida Console", monospace'
                        }}>
                          {'generatedRobots' in actionData ? actionData.generatedRobots : ''}
                        </pre>
                      </Card>
                    </BlockStack>

                    {/* LLMS.txt Preview */}
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingMd">
                        llms.txt.liquid
                      </Text>
                      <Card background="bg-surface-secondary">
                        <pre style={{ 
                          whiteSpace: 'pre-wrap',
                          margin: 0,
                          fontSize: '12px',
                          fontFamily: 'Monaco, "Lucida Console", monospace'
                        }}>
                          {'generatedLlms' in actionData ? actionData.generatedLlms : ''}
                        </pre>
                      </Card>
                    </BlockStack>
                  </BlockStack>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>
        )}
        
        {/* File Contents - Only show when a file is selected */}
        {selectedFile && (
          <Layout>
            <Layout.Section>
              <Card>
                <div ref={fileContentRef}>
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingLg">
                      Current Files
                    </Text>

                    <BlockStack gap="400">
                    {selectedFile === 'robots' && (
                      <BlockStack gap="200">
                        <InlineStack align="space-between">
                          <Text as="h3" variant="headingMd">
                            {editMode === 'robots' ? 'robots.txt - Editing' : 'robots.txt'}
                          </Text>
                          <InlineStack gap="200">
                            <Badge>
                              {status?.currentRobots ? 'Active' : 'Not Found'}
                            </Badge>
                            {editMode !== 'robots' && status?.currentRobots && (
                              <Button size="slim" onClick={() => handleEdit('robots')}>
                                Edit
                              </Button>
                            )}
                          </InlineStack>
                        </InlineStack>

                        {editMode === 'robots' ? (
                          <BlockStack gap="300">
                            <TextField
                              label=""
                              value={editContent}
                              onChange={(value) => {
                                setEditContent(value);
                                setHasChanges(true);
                              }}
                              multiline={10}
                              autoComplete="off"
                              helpText="Edit the robots.txt content below"
                            />
                            <InlineStack gap="200">
                              <Button onClick={handleCancel}>Cancel</Button>
                              <Button
                                variant="primary"
                                onClick={handleSave}
                                disabled={!hasChanges}
                                loading={isLoading && fetcher.formData?.get('actionType') === 'updateFile'}
                              >
                                Save Changes
                              </Button>
                            </InlineStack>
                          </BlockStack>
                        ) : (
                          status?.currentRobots ? (
                            <Card background="bg-surface-secondary">
                              <pre style={{
                                fontFamily: 'monospace',
                                fontSize: '12px',
                                margin: 0,
                                whiteSpace: 'pre-wrap',
                                maxHeight: '400px',
                                overflow: 'auto'
                              }}>
                                {status.currentRobots}
                              </pre>
                            </Card>
                          ) : (
                            <Text as="p" variant="bodyMd" tone="subdued">
                              No robots.txt file found
                            </Text>
                          )
                        )}
                      </BlockStack>
                    )}

                    {selectedFile === 'llms' && (
                      <BlockStack gap="200">
                        <InlineStack align="space-between">
                          <Text as="h3" variant="headingMd">
                            {editMode === 'llms' ? 'llms.txt - Editing' : 'llms.txt'}
                          </Text>
                          <InlineStack gap="200">
                            <Badge>
                              {status?.currentLlms ? 'Active' : 'Not Found'}
                            </Badge>
                            {editMode !== 'llms' && status?.currentLlms && (
                              <Button size="slim" onClick={() => handleEdit('llms')}>
                                Edit
                              </Button>
                            )}
                          </InlineStack>
                        </InlineStack>

                        {editMode === 'llms' ? (
                          <BlockStack gap="300">
                            <TextField
                              label=""
                              value={editContent}
                              onChange={(value) => {
                                setEditContent(value);
                                setHasChanges(true);
                              }}
                              multiline={10}
                              autoComplete="off"
                              helpText="Edit the llms.txt content below"
                            />
                            <InlineStack gap="200">
                              <Button onClick={handleCancel}>Cancel</Button>
                              <Button
                                variant="primary"
                                onClick={handleSave}
                                disabled={!hasChanges}
                                loading={isLoading && fetcher.formData?.get('actionType') === 'updateFile'}
                              >
                                Save Changes
                              </Button>
                            </InlineStack>
                          </BlockStack>
                        ) : (
                          status?.currentLlms ? (
                            <Card background="bg-surface-secondary">
                              <pre style={{
                                fontFamily: 'monospace',
                                fontSize: '12px',
                                margin: 0,
                                whiteSpace: 'pre-wrap',
                                maxHeight: '400px',
                                overflow: 'auto'
                              }}>
                                {status.currentLlms}
                              </pre>
                            </Card>
                          ) : (
                            <Text as="p" variant="bodyMd" tone="subdued">
                              No llms.txt file found
                            </Text>
                          )
                        )}
                      </BlockStack>
                    )}
                    </BlockStack>
                  </BlockStack>
                </div>
              </Card>
            </Layout.Section>
          </Layout>
        )}

      </BlockStack>
    </Page>
  );
}