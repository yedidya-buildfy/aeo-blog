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

    // Get status directly
    const status = await aeoService.getStatus();

    // Load existing keywords from database
    let existingKeywords = null;
    try {
      const keywordAnalysis = await prisma.keywordAnalysis.findFirst({
        where: {
          shopDomain: shopInfo.primaryDomain || 'unknown'
        },
        orderBy: {
          updatedAt: 'desc'
        }
      });

      if (keywordAnalysis) {
        // Check if we have categorized keywords, otherwise convert from legacy format
        if (keywordAnalysis.mainProducts && keywordAnalysis.mainProducts.length > 0) {
          existingKeywords = {
            mainProducts: keywordAnalysis.mainProducts,
            problemsSolved: keywordAnalysis.problemsSolved,
            customerSearches: keywordAnalysis.customerSearches
          };
        } else if (keywordAnalysis.keywords && keywordAnalysis.keywords.length > 0) {
          // Convert legacy flat keywords to categories (distribute evenly)
          const totalKeywords = keywordAnalysis.keywords;
          const thirds = Math.ceil(totalKeywords.length / 3);

          existingKeywords = {
            mainProducts: totalKeywords.slice(0, thirds),
            problemsSolved: totalKeywords.slice(thirds, thirds * 2),
            customerSearches: totalKeywords.slice(thirds * 2)
          };
        }
      }
    } catch (dbError) {
      console.error('Failed to load keywords from database:', dbError);
      // Continue without existing keywords - don't fail the whole loader
    }

    // Load automation schedule
    let automationSchedule = null;
    try {
      const automationService = new AutomationSchedulerService(prisma);
      automationSchedule = await automationService.getSchedule(shopInfo.primaryDomain || 'unknown');
    } catch (automationError) {
      console.error('Failed to load automation schedule:', automationError);
    }

    // Load recent blog posts
    let recentBlogs = [];
    try {
      recentBlogs = await prisma.blogPost.findMany({
        where: {
          shopDomain: shopInfo.primaryDomain || 'unknown'
        },
        orderBy: {
          createdAt: 'desc'
        },
        take: 10, // Last 10 blogs
        select: {
          id: true,
          title: true,
          url: true,
          status: true,
          createdAt: true,
          publishedAt: true,
          primaryTopic: true,
          contentAngle: true
        }
      });
    } catch (blogError) {
      console.error('Failed to load blog posts:', blogError);
    }

    return json({
      status,
      shopInfo,
      existingKeywords,
      automationSchedule,
      recentBlogs,
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
      shopInfo: null,
      existingKeywords: null,
      automationSchedule: null,
      recentBlogs: [],
      error: null
    });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const actionType = formData.get('actionType');
  const selectedKeyword = formData.get('keyword');
  const customUrl = formData.get('customUrl');

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
  const { status: initialStatus, shopInfo, existingKeywords, automationSchedule, recentBlogs, error: loaderError } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();

  const [status, setStatus] = useState(initialStatus);
  const [selectedFile, setSelectedFile] = useState<'robots' | 'llms' | null>(null);
  const [editMode, setEditMode] = useState<'robots' | 'llms' | null>(null);
  const [editContent, setEditContent] = useState<string>('');
  const [hasChanges, setHasChanges] = useState(false);
  const fileContentRef = useRef<HTMLDivElement>(null);

  // SEO Blog Generation state
  const [keywordData, setKeywordData] = useState<KeywordData | null>(existingKeywords);
  const [generatedBlog, setGeneratedBlog] = useState<any>(null);
  const [customUrl, setCustomUrl] = useState<string>('https://drive-buddy.com/');
  const [isBlogGenerating, setIsBlogGenerating] = useState<boolean>(false);

  // Local state for editable keywords
  const [localKeywords, setLocalKeywords] = useState<KeywordData>(keywordData || {
    mainProducts: [],
    problemsSolved: [],
    customerSearches: []
  });
  const [keywordHasChanges, setKeywordHasChanges] = useState(false);
  
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
  // Update local keywords when new data is fetched
  useEffect(() => {
    if (keywordData) {
      setLocalKeywords(keywordData);
      setKeywordHasChanges(false);
    }
  }, [keywordData]);

  // Keyword editing functions
  const updateKeyword = (category: keyof KeywordData, index: number, value: string) => {
    const updated = { ...localKeywords };

    if (value.trim()) {
      // Ensure array exists and has enough slots
      if (!updated[category]) updated[category] = [];
      updated[category][index] = value.trim();
    } else {
      // Remove empty values
      if (updated[category] && updated[category][index] !== undefined) {
        updated[category].splice(index, 1);
      }
    }

    setLocalKeywords(updated);
    setKeywordHasChanges(true);
  };

  const saveAllKeywords = () => {
    fetcher.submit({
      actionType: 'updateKeywords',
      keywordData: JSON.stringify(localKeywords)
    }, { method: 'POST' });
    setKeywordHasChanges(false);
  };

  const handleGenerateIntelligentBlog = async () => {
    try {
      setIsBlogGenerating(true);
      setGeneratedBlog(null); // Clear previous result

      const response = await fetch('/api/generate-blog', { method: 'POST' });
      const result = await response.json();

      if (result.success) {
        setGeneratedBlog(result);
        shopify.toast.show("Intelligent blog generated successfully!");

        // Redirect to the created blog after 3 seconds
        if (result.blog?.url) {
          setTimeout(() => {
            window.open(result.blog.url, '_blank');
          }, 3000);
        }
      } else {
        let errorMessage = result.error || "Failed to generate blog";

        // Handle specific error types with user-friendly messages
        if (result.needsKeywords) {
          errorMessage = "Please generate keywords first using the 'Find Keywords' button above.";
        } else if (result.rateLimitExceeded) {
          errorMessage = "Rate limit exceeded. You can generate up to 5 blogs per hour.";
        } else if (result.retryable) {
          errorMessage += " Please try again in a few minutes.";
        }

        shopify.toast.show(errorMessage, { isError: true });
      }
    } catch (error) {
      shopify.toast.show("Network error. Please check your connection and try again.", { isError: true });
    } finally {
      setIsBlogGenerating(false);
    }
  };

  const handleGenerateKeywordsAndBlog = async () => {
    try {
      // Step 1: Generate keywords if we don't have them
      if (!keywordData || keywordData.mainProducts.length === 0) {
        const formData = new FormData();
        formData.append('actionType', 'findKeywords');
        if (customUrl) {
          formData.append('customUrl', customUrl);
        }
        fetcher.submit(formData, { method: 'POST' });

        // Wait for keywords to be generated before proceeding to blog
        return;
      }

      // Step 2: Generate blog if we already have keywords
      setIsBlogGenerating(true);
      setGeneratedBlog(null);

      const response = await fetch('/api/generate-blog', { method: 'POST' });
      const result = await response.json();

      if (result.success) {
        setGeneratedBlog(result);
        shopify.toast.show("SEO blog generated successfully!");

        if (result.blog?.url) {
          setTimeout(() => {
            window.open(result.blog.url, '_blank');
          }, 3000);
        }
      } else {
        let errorMessage = result.error || "Failed to generate blog";
        if (result.needsKeywords) {
          errorMessage = "Please generate keywords first using the 'Generate SEO Blog' button above.";
        } else if (result.rateLimitExceeded) {
          errorMessage = "Rate limit exceeded. You can generate up to 5 blogs per hour.";
        } else if (result.retryable) {
          errorMessage += " Please try again in a few minutes.";
        }
        shopify.toast.show(errorMessage, { isError: true });
      }
    } catch (error) {
      shopify.toast.show("Network error. Please check your connection and try again.", { isError: true });
    } finally {
      setIsBlogGenerating(false);
    }
  };

  const handleRegenerateKeywords = () => {
    fetcher.submit({
      actionType: 'regenerateKeywords',
      customUrl: customUrl || ''
    }, { method: 'POST' });
  };

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

      <Layout>
        {/* Blog Posts Sidebar - Left Column */}
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="400">
              <Text as="h3" variant="headingMd">
                📝 Your Generated Blogs
              </Text>

              {recentBlogs.length > 0 ? (
                <BlockStack gap="200">
                  {recentBlogs.map((blog: any) => (
                    <Card key={blog.id} background="bg-surface-secondary">
                      <BlockStack gap="200">
                        <Text as="h4" variant="headingSm">
                          {blog.title}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {blog.primaryTopic}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {new Date(blog.createdAt).toLocaleDateString()}
                        </Text>
                        <InlineStack gap="200">
                          <Badge tone={blog.status === 'published' ? 'success' : 'info'}>
                            {blog.status}
                          </Badge>
                          {blog.url && (
                            <Button
                              size="slim"
                              variant="plain"
                              onClick={() => window.open(blog.url, '_blank')}
                            >
                              View
                            </Button>
                          )}
                        </InlineStack>
                      </BlockStack>
                    </Card>
                  ))}
                </BlockStack>
              ) : (
                <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
                  No blogs created yet. Generate your first SEO blog!
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Main Content - Right Column */}
        <Layout.Section>
          <BlockStack gap="500">
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
                <BlockStack gap="400" align="space-between" inlineAlign="stretch">
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
                </BlockStack>
                </Card>
              </Layout.Section>
            </Layout>
          </BlockStack>
        </Layout.Section>

      </Layout>

      <BlockStack gap="500">
        {/* Applied Files Section */}
        {actionData && actionData.success && actionData.generatedRobots && actionData.generatedLlms && fetcher.formData?.get('actionType') === 'improve' && (
          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingLg">
                    Applied AEO Files
                  </Text>
                  <Text as="p" variant="bodyMd" tone="success">
                    Files successfully applied to your theme for: {actionData.homepageUrl}
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
                          {actionData.generatedRobots}
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
                          {actionData.generatedLlms}
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

        {/* SEO Blog Generation Card */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="200">
                  <Text as="h2" variant="headingLg">
                    Automated SEO Blog Generation
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Generate SEO-optimized blogs automatically for your store: {shopInfo?.primaryDomain}
                  </Text>
                </BlockStack>

                {/* One-Click SEO Blog Generation */}
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">
                    🚀 One-Click SEO Blog Generation
                  </Text>

                  <TextField
                    label="Website URL to analyze (optional)"
                    value={customUrl}
                    onChange={setCustomUrl}
                    placeholder="https://drive-buddy.com/"
                    helpText="Leave empty to use your shop's domain, or enter a custom URL for testing"
                    autoComplete="url"
                  />

                  <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <Button
                      variant="primary"
                      size="large"
                      onClick={handleGenerateKeywordsAndBlog}
                      loading={isLoading || isBlogGenerating}
                    >
                      {isLoading ? 'Finding Keywords...' :
                       isBlogGenerating ? 'Creating SEO Blog...' :
                       keywordData ? '🚀 Generate SEO Blog Post' : '🚀 Generate Keywords & SEO Blog'}
                    </Button>

                    {keywordData && (
                      <Button
                        variant="secondary"
                        size="large"
                        onClick={handleRegenerateKeywords}
                        loading={isLoading && fetcher.formData?.get('actionType') === 'regenerateKeywords'}
                      >
                        {isLoading && fetcher.formData?.get('actionType') === 'regenerateKeywords'
                          ? 'Regenerating Keywords...'
                          : '🔄 Re-gen Keywords'}
                      </Button>
                    )}
                  </div>

                  <Text as="p" variant="bodySm" tone="subdued">
                    {keywordData ?
                      'Creates a unique SEO blog post using your existing keywords. Generates new keywords first if needed.' :
                      'Discovers keywords from your website and creates an SEO-optimized blog post automatically.'}
                  </Text>

                  {localKeywords && (
                    <Card background="bg-surface-secondary">
                      <BlockStack gap="400">
                        <BlockStack gap="200">
                          <Text as="h4" variant="headingMd">
                            ⚙️ Advanced: Edit Keywords (Optional)
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            All keywords below will be used to generate comprehensive, SEO-rich blog content
                          </Text>
                          {keywordHasChanges && (
                            <Text as="p" variant="bodySm" tone="subdued">
                              ⚠️ You have unsaved changes
                            </Text>
                          )}
                        </BlockStack>

                        {/* Headers */}
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr 1fr',
                          gap: '1rem',
                          paddingBottom: '0.5rem',
                          borderBottom: '1px solid #e1e5e9'
                        }}>
                          <Text variant="headingSm" as="h5">Main Products/Services</Text>
                          <Text variant="headingSm" as="h5">Problems Solved</Text>
                          <Text variant="headingSm" as="h5">Customer Searches</Text>
                        </div>

                        {/* Editable Rows */}
                        {(() => {
                          const maxRows = Math.max(
                            localKeywords.mainProducts?.length || 0,
                            localKeywords.problemsSolved?.length || 0,
                            localKeywords.customerSearches?.length || 0,
                            5 // Minimum 5 rows for adding new keywords
                          );

                          return Array.from({ length: maxRows }, (_, i) => (
                            <div key={i} style={{
                              display: 'grid',
                              gridTemplateColumns: '1fr 1fr 1fr',
                              gap: '1rem',
                              alignItems: 'start'
                            }}>
                              <div style={{ position: 'relative' }}>
                                <TextField
                                  label=""
                                  value={localKeywords.mainProducts?.[i] || ''}
                                  onChange={(value) => updateKeyword('mainProducts', i, value)}
                                  placeholder="Add keyword..."
                                  autoComplete="off"
                                />
                              </div>
                              <div style={{ position: 'relative' }}>
                                <TextField
                                  label=""
                                  value={localKeywords.problemsSolved?.[i] || ''}
                                  onChange={(value) => updateKeyword('problemsSolved', i, value)}
                                  placeholder="Add keyword..."
                                  autoComplete="off"
                                />
                              </div>
                              <div style={{ position: 'relative' }}>
                                <TextField
                                  label=""
                                  value={localKeywords.customerSearches?.[i] || ''}
                                  onChange={(value) => updateKeyword('customerSearches', i, value)}
                                  placeholder="Add keyword..."
                                  autoComplete="off"
                                />
                              </div>
                            </div>
                          ));
                        })()
                        }

                        {/* Save Button */}
                        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                          <Button
                            onClick={saveAllKeywords}
                            variant="primary"
                            disabled={!keywordHasChanges}
                            loading={isLoading && fetcher.formData?.get('actionType') === 'updateKeywords'}
                          >
                            {isLoading && fetcher.formData?.get('actionType') === 'updateKeywords'
                              ? 'Saving...'
                              : 'Save All Changes'
                            }
                          </Button>
                          {keywordHasChanges && (
                            <Text as="p" variant="bodySm" tone="subdued">
                              Remember to save your changes
                            </Text>
                          )}
                        </div>

                      </BlockStack>
                    </Card>
                  )}
                </BlockStack>

                {/* Generated Blog Results */}
                {generatedBlog && (
                    <Card background="bg-surface-success">
                      <BlockStack gap="200">
                        <Text as="h4" variant="headingMd" tone="success">
                          SEO Blog Generated Successfully! 🚀
                        </Text>
                        <Text as="p" variant="bodyMd">
                          <strong>{generatedBlog.blog?.title}</strong>
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          Content Angle: {generatedBlog.blog?.contentAngle} |
                          Word Count: {generatedBlog.blog?.wordCount} |
                          Keywords Used: {generatedBlog.blog?.keywordsUsed?.length || 0}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          Blog ID: {generatedBlog.blog?.shopifyBlogId}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          Article ID: {generatedBlog.blog?.shopifyArticleId}
                        </Text>
                        {generatedBlog.blog?.url && (
                          <Text as="p" variant="bodySm" tone="success">
                            🎉 Opening blog in new tab in 3 seconds...
                          </Text>
                        )}
                        {generatedBlog.statistics && (
                          <Text as="p" variant="bodySm" tone="subdued">
                            Uniqueness: {generatedBlog.statistics.isUnique ? '✅ Unique' : '⚠ Similar content detected'}
                          </Text>
                        )}
                        {generatedBlog.rateLimitRemaining !== undefined && (
                          <Text as="p" variant="bodySm" tone="subdued">
                            Rate Limit: {generatedBlog.rateLimitRemaining} blogs remaining this hour
                          </Text>
                        )}
                      </BlockStack>
                    </Card>
                  )}

                {/* Step 3: Start Automation */}
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">
                    Step 3: Start Automation
                  </Text>
                  <Button
                    variant="primary"
                    onClick={() => {
                      const formData = new FormData();
                      formData.append('actionType', automationSchedule?.enabled ? 'disableAutomation' : 'enableAutomation');
                      fetcher.submit(formData, { method: 'POST' });
                    }}
                    loading={isLoading && (fetcher.formData?.get('actionType') === 'enableAutomation' || fetcher.formData?.get('actionType') === 'disableAutomation')}
                  >
                    {automationSchedule?.enabled ? 'Stop Weekly Publishing' : 'Start Weekly Publishing'}
                  </Button>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Automatically publishes 1 blog per week
                  </Text>
                </BlockStack>

              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}