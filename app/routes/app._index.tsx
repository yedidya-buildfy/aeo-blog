import { useEffect, useState } from "react";
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
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { AEOService } from "../services/aeo.service";
import { ShopifyThemeService } from "../services/shopify-theme.service";
import { ShopifyShopService } from "../services/shopify-shop.service";
import { GeminiService } from "../services/gemini.service";
import { BackupService } from "../services/backup.service";
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

    const aeoService = new AEOService(
      themeService,
      shopService,
      geminiService,
      backupService
    );

    // Get status directly
    const status = await aeoService.getStatus();
    return json({ status, error: null });
  } catch (error) {
    console.error('Error in loader:', error);
    
    // Return default state for authentication issues
    return json({ 
      status: {
        shopDomain: 'Authenticating...',
        homepageUrl: '',
        currentRobots: null,
        currentLlms: null,
        lastOperation: null,
        backups: [],
      }, 
      error: null 
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

    if (actionType === 'preview') {
      console.log("Starting AEO preview generation...");
      const result = await aeoService.previewAEO();
      
      if (result.success) {
        console.log("AEO preview generated successfully");
      } else {
        console.log("AEO preview failed:", result.error);
      }
      
      return json(result);
    } else if (actionType === 'improve') {
      console.log("Starting AEO improvement...");
      const result = await aeoService.improveAEO();
      
      if (result.success) {
        console.log("AEO improvement completed successfully");
      } else {
        console.log("AEO improvement failed:", result.error);
      }
      
      return json(result);
    } else if (actionType === 'restore') {
      console.log("Starting backup restore...");
      const result = await aeoService.restoreBackup();
      
      if (result.success) {
        console.log("Backup restore completed successfully");
      } else {
        console.log("Backup restore failed:", result.error);
      }
      
      return json(result);
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

export default function AEODashboard() {
  const { status: initialStatus, error: loaderError } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();
  
  const [status, setStatus] = useState(initialStatus);
  
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
        
        if (actionType === 'preview') {
          message = "AEO files generated successfully! Check the preview below.";
        } else if (actionType === 'improve') {
          message = "AEO improvement completed successfully!";
        } else if (actionType === 'restore') {
          message = "Backup restored successfully!";
        }
        
        shopify.toast.show(message);
        
        // For preview, don't refresh the page so user can see the results
        if (actionType !== 'preview') {
          revalidator.revalidate();
        }
      } else {
        shopify.toast.show(`Error: ${actionData.error}`, { isError: true });
      }
    }
  }, [actionData, shopify, revalidator, fetcher.formData]);

  const handlePreviewAEO = () => {
    const formData = new FormData();
    formData.append('actionType', 'preview');
    fetcher.submit(formData, { method: 'POST' });
  };

  const handleRestoreBackup = () => {
    const formData = new FormData();
    formData.append('actionType', 'restore');
    fetcher.submit(formData, { method: 'POST' });
  };

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

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
                    Preview your store's optimized AEO files for AI search engines. 
                    This will generate robots.txt and llms.txt content using Gemini AI for you to review.
                  </Text>
                </BlockStack>
                
                <InlineStack gap="300">
                  <Button
                    variant="primary"
                    size="large"
                    onClick={handlePreviewAEO}
                    loading={isLoading && fetcher.formData?.get('actionType') === 'preview'}
                  >
                    {isLoading && fetcher.formData?.get('actionType') === 'preview' ? (
                      <InlineStack gap="200" align="center">
                        <Spinner size="small" />
                        <Text as="span">Generating Preview...</Text>
                      </InlineStack>
                    ) : (
                      'Generate AEO Preview'
                    )}
                  </Button>
                  
                  {status?.backups && status.backups.length > 0 && (
                    <Button
                      onClick={handleRestoreBackup}
                      loading={isLoading && fetcher.formData?.get('actionType') === 'restore'}
                    >
                      {isLoading && fetcher.formData?.get('actionType') === 'restore' ? (
                        <InlineStack gap="200" align="center">
                          <Spinner size="small" />
                          <Text as="span">Restoring...</Text>
                        </InlineStack>
                      ) : (
                        'Restore Backup'
                      )}
                    </Button>
                  )}
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
          
          {/* Status Sidebar */}
          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">
                    Status
                  </Text>
                  {status?.lastOperation ? (
                    <BlockStack gap="200">
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodyMd">Last Operation</Text>
                        {getStatusBadge(status.lastOperation.status)}
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {formatDateTime(status.lastOperation.createdAt)}
                      </Text>
                      {status.lastOperation.error && (
                        <Banner status="critical" title="Last Error">
                          <p>{status.lastOperation.error}</p>
                        </Banner>
                      )}
                    </BlockStack>
                  ) : (
                    <Text as="p" variant="bodyMd" tone="subdued">
                      No operations yet
                    </Text>
                  )}
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">
                    Store Info
                  </Text>
                  <BlockStack gap="100">
                    <Text as="p" variant="bodyMd">
                      <Text as="span" variant="bodyMd" fontWeight="semibold">Domain:</Text>{' '}
                      {status?.shopDomain || 'Loading...'}
                    </Text>
                    <Text as="p" variant="bodyMd">
                      <Text as="span" variant="bodyMd" fontWeight="semibold">Homepage:</Text>{' '}
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
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
        
        {/* Preview Section */}
        {actionData && actionData.success && actionData.generatedRobots && actionData.generatedLlms && (
          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingLg">
                    Generated AEO Files Preview
                  </Text>
                  <Text as="p" variant="bodyMd" tone="success">
                    Files generated successfully for: {actionData.homepageUrl}
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
        
        {/* File Contents */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingLg">
                  Current Files
                </Text>
                
                <BlockStack gap="400">
                  {/* Robots.txt */}
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text as="h3" variant="headingMd">
                        robots.txt
                      </Text>
                      <Badge>
                        {status?.currentRobots ? 'Active' : 'Not Found'}
                      </Badge>
                    </InlineStack>
                    
                    {status?.currentRobots ? (
                      <Card background="bg-surface-secondary">
                        <pre style={{ 
                          fontFamily: 'monospace', 
                          fontSize: '12px', 
                          margin: 0,
                          whiteSpace: 'pre-wrap',
                          maxHeight: '200px',
                          overflow: 'auto'
                        }}>
                          {status.currentRobots}
                        </pre>
                      </Card>
                    ) : (
                      <Text as="p" variant="bodyMd" tone="subdued">
                        No robots.txt file found
                      </Text>
                    )}
                  </BlockStack>
                  
                  <Divider />
                  
                  {/* LLMS.txt */}
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text as="h3" variant="headingMd">
                        llms.txt
                      </Text>
                      <Badge>
                        {status?.currentLlms ? 'Active' : 'Not Found'}
                      </Badge>
                    </InlineStack>
                    
                    {status?.currentLlms ? (
                      <Card background="bg-surface-secondary">
                        <pre style={{ 
                          fontFamily: 'monospace', 
                          fontSize: '12px', 
                          margin: 0,
                          whiteSpace: 'pre-wrap',
                          maxHeight: '300px',
                          overflow: 'auto'
                        }}>
                          {status.currentLlms}
                        </pre>
                      </Card>
                    ) : (
                      <Text as="p" variant="bodyMd" tone="subdued">
                        No llms.txt file found
                      </Text>
                    )}
                  </BlockStack>
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}