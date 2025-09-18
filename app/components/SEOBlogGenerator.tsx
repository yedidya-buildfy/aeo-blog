import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  Badge,
  List,
  TextField,
  DataTable,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { GeminiService } from "../services/gemini.service";
import { ShopifyShopService } from "../services/shopify-shop.service";
import { checkAutomation } from "../services/automation-middleware.service";
import { AutomationSchedulerService } from "../services/automation-scheduler.service";
import prisma from "../db.server";

// Import the loader and action from the existing route
import { loader as seoLoader, action as seoAction } from "../routes/app.seo-blogs";

// Language-aware fallback keywords function (duplicate from seo-blogs for now)
function getFallbackKeywordsByLanguage(url: string) {
  const isHebrew = url.includes('.co.il') || url.includes('hebrew') || url.includes('israel');
  const isSpanish = url.includes('.es') || url.includes('.mx') || url.includes('.ar') || url.includes('.co') || url.includes('.pe');
  const isFrench = url.includes('.fr') || url.includes('.ca');
  const isGerman = url.includes('.de') || url.includes('.at') || url.includes('.ch');

  if (isHebrew) {
    return {
      mainProducts: ['מוצרי ניקוי', 'ציפויים מגנים', 'טיפול משטחים', 'פתרונות תחזוקה', 'מוצרי טיפוח'],
      problemsSolved: ['הסרת כתמים', 'הגנה על משטחים', 'ניקוי קל', 'דחיית מים', 'תחזוקה'],
      customerSearches: ['איך לנקות', 'הגנה על משטחים', 'פתרון ניקוי', 'טיפים תחזוקה', 'טיפוח מוצרים']
    };
  }

  if (isSpanish) {
    return {
      mainProducts: ['productos de limpieza', 'recubrimientos protectores', 'tratamiento de superficies', 'soluciones de mantenimiento', 'productos de cuidado'],
      problemsSolved: ['eliminación de manchas', 'protección de superficies', 'limpieza fácil', 'repelente al agua', 'mantenimiento'],
      customerSearches: ['cómo limpiar', 'protección de superficies', 'solución de limpieza', 'consejos de mantenimiento', 'cuidado de productos']
    };
  }

  if (isFrench) {
    return {
      mainProducts: ['produits de nettoyage', 'revêtements protecteurs', 'traitement de surface', 'solutions d\'entretien', 'produits de soin'],
      problemsSolved: ['élimination des taches', 'protection de surface', 'nettoyage facile', 'hydrofuge', 'entretien'],
      customerSearches: ['comment nettoyer', 'protection de surface', 'solution de nettoyage', 'conseils d\'entretien', 'soin des produits']
    };
  }

  if (isGerman) {
    return {
      mainProducts: ['Reinigungsprodukte', 'Schutzbeschichtungen', 'Oberflächenbehandlung', 'Wartungslösungen', 'Pflegeprodukte'],
      problemsSolved: ['Fleckenentfernung', 'Oberflächenschutz', 'einfache Reinigung', 'wasserabweisend', 'Wartung'],
      customerSearches: ['wie reinigen', 'Oberflächenschutz', 'Reinigungslösung', 'Wartungstipps', 'Produktpflege']
    };
  }

  // Default to English
  return {
    mainProducts: ['cleaning products', 'protective coatings', 'surface treatment', 'maintenance solutions', 'care products'],
    problemsSolved: ['stain removal', 'surface protection', 'easy cleaning', 'water repelling', 'maintenance'],
    customerSearches: ['how to clean', 'surface protection', 'cleaning solution', 'maintenance tips', 'product care']
  };
}

interface KeywordData {
  mainProducts: string[];
  problemsSolved: string[];
  customerSearches: string[];
}

interface SEOBlogGeneratorProps {
  loaderData: any;
  actionData?: any;
  isLoading: boolean;
  fetcher: any;
}

export function SEOBlogGenerator({ loaderData, actionData, isLoading, fetcher }: SEOBlogGeneratorProps) {
  const { shopInfo, existingKeywords, recentBlogs, automationSchedule, error: loaderError } = loaderData;

  // Remove toast notifications to fix SSR issues
  const showNotification = (message: string, isError = false) => {
    if (typeof window !== 'undefined') {
      console.log(isError ? `Error: ${message}` : message);
    }
  };

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
  const [hasChanges, setHasChanges] = useState(false);

  // Update local keywords when new data is fetched
  useEffect(() => {
    if (keywordData) {
      setLocalKeywords(keywordData);
      setHasChanges(false);
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
    setHasChanges(true);
  };

  const saveAllKeywords = () => {
    fetcher.submit({
      actionType: 'updateKeywords',
      keywordData: JSON.stringify(localKeywords)
    }, { method: 'POST' });
    setHasChanges(false);
  };

  // Show message when existing keywords are loaded from database
  useEffect(() => {
    if (typeof window !== 'undefined' && existingKeywords && !actionData) {
      const totalKeywords = existingKeywords.mainProducts.length +
                           existingKeywords.problemsSolved.length +
                           existingKeywords.customerSearches.length;
      if (totalKeywords > 0) {
        showNotification(`Found ${totalKeywords} existing keywords from database!`);
      }
    }
  }, [existingKeywords, actionData]);

  // Handle action completion - removed toast to fix SSR issues
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (actionData && actionData.success && (actionData as any).keywordData) {
        // Handle updateKeywords action - update local state
        if (fetcher.formData?.get('actionType') === 'updateKeywords') {
          setKeywordData((actionData as any).keywordData);
          setLocalKeywords((actionData as any).keywordData);
          setHasChanges(false);
          showNotification("Keywords saved successfully!");
        }
        // Handle regenerateKeywords action - update keywords without auto-generating blog
        else if (fetcher.formData?.get('actionType') === 'regenerateKeywords') {
          setKeywordData((actionData as any).keywordData);
          setLocalKeywords((actionData as any).keywordData);
          setHasChanges(false);
          const totalKeywords = (actionData as any).keywordData.mainProducts.length +
                                (actionData as any).keywordData.problemsSolved.length +
                                (actionData as any).keywordData.customerSearches.length;
          showNotification(`Keywords regenerated successfully! Found ${totalKeywords} new keywords.`);
        }
        // Handle findKeywords action - new keywords generated, now auto-generate blog
        else if (!keywordData || keywordData === existingKeywords) {
          setKeywordData((actionData as any).keywordData);
          showNotification("Keywords generated! Now creating SEO blog...");

          // Auto-generate blog after keywords are generated
          setTimeout(() => {
            handleGenerateIntelligentBlog();
          }, 1000);
        }
      } else if (actionData && !actionData.success) {
        showNotification(`Error: ${(actionData as any).error}`, true);
      }
    }
  }, [actionData, keywordData, existingKeywords, fetcher.formData]);

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
        showNotification("SEO blog generated successfully!", false);

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
        showNotification(errorMessage, true);
      }
    } catch (error) {
      showNotification("Network error. Please check your connection and try again.", true);
    } finally {
      setIsBlogGenerating(false);
    }
  };

  const handleGenerateIntelligentBlog = async () => {
    try {
      setIsBlogGenerating(true);
      setGeneratedBlog(null); // Clear previous result

      const response = await fetch('/api/generate-blog', { method: 'POST' });
      const result = await response.json();

      if (result.success) {
        setGeneratedBlog(result);
        showNotification("Intelligent blog generated successfully!", false);

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

        showNotification(errorMessage, true);
      }
    } catch (error) {
      showNotification("Network error. Please check your connection and try again.", true);
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

  if (loaderError) {
    return (
      <Card>
        <Text as="p" variant="bodyMd" tone="critical">
          Error: {loaderError}
        </Text>
      </Card>
    );
  }

  return (
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
                  {hasChanges && (
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
                    disabled={!hasChanges}
                    loading={isLoading && fetcher.formData?.get('actionType') === 'updateKeywords'}
                  >
                    {isLoading && fetcher.formData?.get('actionType') === 'updateKeywords'
                      ? 'Saving...'
                      : 'Save All Changes'
                    }
                  </Button>
                  {hasChanges && (
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
  );
}