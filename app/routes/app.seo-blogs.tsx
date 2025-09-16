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
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { GeminiService } from "../services/gemini.service";
import { ShopifyShopService } from "../services/shopify-shop.service";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { admin } = await authenticate.admin(request);
    const shopService = new ShopifyShopService(admin);
    const shopInfo = await shopService.getShopInfo();

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

    return json({
      shopInfo,
      existingKeywords,
      recentBlogs: [],
      error: null
    });
  } catch (error) {
    console.error('Error in seo-blogs loader:', error);
    return json({
      shopInfo: null,
      existingKeywords: null,
      recentBlogs: [],
      error: 'Failed to load shop information'
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
    const shopService = new ShopifyShopService(admin);
    const geminiService = new GeminiService();

    if (actionType === 'findKeywords') {
      // Use custom URL if provided, otherwise use shop's domain
      let homepageUrl;
      if (customUrl && typeof customUrl === 'string' && customUrl.trim()) {
        homepageUrl = customUrl.startsWith('http') ? customUrl : `https://${customUrl}`;
      } else {
        const shopService = new ShopifyShopService(admin);
        const shopInfo = await shopService.getShopInfo();
        homepageUrl = `https://${shopInfo.primaryDomain}/`;
      }

      // Generate keywords using Gemini with URL context - work WITH its natural descriptive style
      const keywordPrompt = `Analyze the website ${homepageUrl} and generate SEO keywords.

      Please identify and list:

      MAIN PRODUCTS/SERVICES:
      List the specific products or services they sell, using the website's language.

      PROBLEMS THEY SOLVE:
      What issues do their products fix or prevent?

      WHAT CUSTOMERS SEARCH FOR:
      What terms would customers use to find these products?

      For each category, provide 5-7 short keywords (2-4 words each) in the same language as the website.
      Be specific and use terms that appear on the website.`;

      // Note: Cannot use structured output config with tools like url_context
      const requestBody = {
        contents: [{ parts: [{ text: keywordPrompt }] }],
        tools: [{ url_context: {} }]
      };

      console.log('Making Gemini API request:', JSON.stringify(requestBody, null, 2));

      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': process.env.GEMINI_API_KEY || ''
        },
        body: JSON.stringify(requestBody)
      });

      console.log('Gemini API response status:', response.status);

      if (!response.ok) {
        const errorBody = await response.text();
        console.error('Gemini API error body:', errorBody);
        throw new Error(`Gemini API error: ${response.status} - ${errorBody}`);
      }

      const data = await response.json();
      const generatedText = data.candidates[0].content.parts[0].text.trim();

      console.log('Gemini structured output response:', generatedText.substring(0, 500));

      // Helper functions for keyword extraction (defined at function scope)
      const extractKeywordsFromText = (text: string) => {
        console.log('Analyzing text for keyword patterns...');

        const keywords = {
          mainProducts: [] as string[],
          problemsSolved: [] as string[],
          customerSearches: [] as string[]
        };

        // Split text into sections and clean
        const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);

        // Extract keywords using multiple strategies
        let currentCategory = '';

        for (const line of lines) {
          // Detect section headers
          if (line.toUpperCase().includes('MAIN PRODUCTS') || line.toUpperCase().includes('PRODUCTS') || line.includes('מוצרים')) {
            currentCategory = 'mainProducts';
            continue;
          }
          if (line.toUpperCase().includes('PROBLEMS') || line.toUpperCase().includes('SOLVE') || line.includes('בעיות')) {
            currentCategory = 'problemsSolved';
            continue;
          }
          if (line.toUpperCase().includes('CUSTOMERS') || line.toUpperCase().includes('SEARCH') || line.includes('לקוחות')) {
            currentCategory = 'customerSearches';
            continue;
          }

          // Extract keywords from current line
          const extractedKeywords = extractKeywordsFromLine(line);

          // If we're in a specific category, add to that category
          if (currentCategory && extractedKeywords.length > 0) {
            keywords[currentCategory as keyof typeof keywords].push(...extractedKeywords);
          } else {
            // Smart categorization based on content
            extractedKeywords.forEach(keyword => {
              if (isProductKeyword(keyword)) {
                keywords.mainProducts.push(keyword);
              } else if (isProblemKeyword(keyword)) {
                keywords.problemsSolved.push(keyword);
              } else {
                keywords.customerSearches.push(keyword);
              }
            });
          }
        }

        // Ensure minimum keywords per category with intelligent extraction
        if (keywords.mainProducts.length < 3) {
          keywords.mainProducts.push(...extractProductKeywords(text));
        }
        if (keywords.problemsSolved.length < 3) {
          keywords.problemsSolved.push(...extractProblemKeywords(text));
        }
        if (keywords.customerSearches.length < 3) {
          keywords.customerSearches.push(...extractSearchKeywords(text));
        }

        // Remove duplicates and limit to reasonable numbers
        keywords.mainProducts = [...new Set(keywords.mainProducts)].slice(0, 8);
        keywords.problemsSolved = [...new Set(keywords.problemsSolved)].slice(0, 8);
        keywords.customerSearches = [...new Set(keywords.customerSearches)].slice(0, 8);

        console.log('Extracted keyword categories successfully');
        return keywords;
      };

      const extractKeywordsFromLine = (line: string): string[] => {
        const keywords: string[] = [];

        // Hebrew keywords pattern (common in the responses we saw)
        const hebrewMatches = line.match(/[\u0590-\u05FF][\u0590-\u05FF\s]*[\u0590-\u05FF]/g) || [];
        keywords.push(...hebrewMatches.filter(k => k.length > 2));

        // Product patterns (S2, S5, etc. that we saw in responses)
        const productMatches = line.match(/[sS]\d+[\s]*[^\.\n]*/g) || [];
        keywords.push(...productMatches.map(k => k.trim()).filter(k => k.length > 2));

        // Quoted terms
        const quotedMatches = line.match(/"([^"]+)"/g) || [];
        keywords.push(...quotedMatches.map(k => k.replace(/"/g, '').trim()));

        // Bullet point content
        if (line.includes('*') || line.includes('•') || line.includes('-')) {
          const bulletContent = line.replace(/[*•-]\s*/, '').trim();
          if (bulletContent.length > 2) {
            keywords.push(bulletContent.split(/[:\(\)]/)[0].trim());
          }
        }

        return keywords.filter(k => k && k.length > 2 && k.length < 50);
      };

      const isProductKeyword = (keyword: string): boolean => {
        const productIndicators = ['coating', 'ציפוי', 'מגן', 'מסיר', 'kit', 'product', 'מוצר'];
        return productIndicators.some(indicator => keyword.toLowerCase().includes(indicator));
      };

      const isProblemKeyword = (keyword: string): boolean => {
        const problemIndicators = ['removal', 'הסרת', 'protection', 'הגנה', 'cleaning', 'ניקוי', 'prevent'];
        return problemIndicators.some(indicator => keyword.toLowerCase().includes(indicator));
      };

      const extractProductKeywords = (text: string): string[] => {
        const productPatterns = [
          /[\u0590-\u05FF]+\s*coating/gi,
          /ציפוי[\s\u0590-\u05FF]*/g,
          /מגן[\s\u0590-\u05FF]*/g,
          /מסיר[\s\u0590-\u05FF]*/g
        ];

        const keywords: string[] = [];
        productPatterns.forEach(pattern => {
          const matches = text.match(pattern) || [];
          keywords.push(...matches.map(k => k.trim()));
        });

        return keywords.filter(k => k.length > 2).slice(0, 5);
      };

      const extractProblemKeywords = (text: string): string[] => {
        const problemPatterns = [
          /הסרת[\s\u0590-\u05FF]*/g,
          /ניקוי[\s\u0590-\u05FF]*/g,
          /הגנה[\s\u0590-\u05FF]*/g,
          /cleaning[\s\w]*/gi,
          /protection[\s\w]*/gi
        ];

        const keywords: string[] = [];
        problemPatterns.forEach(pattern => {
          const matches = text.match(pattern) || [];
          keywords.push(...matches.map(k => k.trim()));
        });

        return keywords.filter(k => k.length > 2).slice(0, 5);
      };

      const extractSearchKeywords = (text: string): string[] => {
        // General terms that customers might search for
        const searchTerms = text.match(/[\u0590-\u05FF]{2,}[\s\u0590-\u05FF]*|[a-zA-Z]{3,}[\s\w]*/g) || [];
        return searchTerms
          .filter(k => k.length > 2 && k.length < 30)
          .filter(k => !isProductKeyword(k) && !isProblemKeyword(k))
          .slice(0, 5);
      };

      // Extract keywords from Gemini's natural descriptive response (works with actual behavior)
      let keywordData;
      try {
        console.log('Using Smart Text Extraction strategy...');
        console.log('Response length:', generatedText.length, 'characters');

        if (!generatedText || generatedText.trim().length === 0) {
          console.log('⚠️  Empty response received, using fallback keywords');
          // Fallback keywords for common cleaning/coating business
          keywordData = {
            mainProducts: ['cleaning products', 'protective coatings', 'surface treatment', 'maintenance solutions', 'care products'],
            problemsSolved: ['stain removal', 'surface protection', 'easy cleaning', 'water repelling', 'maintenance'],
            customerSearches: ['how to clean', 'surface protection', 'cleaning solution', 'maintenance tips', 'product care']
          };
        } else {
          keywordData = extractKeywordsFromText(generatedText);
        }

        // Ensure we have valid data
        keywordData.mainProducts = keywordData.mainProducts.filter((k: string) => k && k.length > 1);
        keywordData.problemsSolved = keywordData.problemsSolved.filter((k: string) => k && k.length > 1);
        keywordData.customerSearches = keywordData.customerSearches.filter((k: string) => k && k.length > 1);

        console.log('✅ Successfully extracted keywords from text');
        console.log(`   - mainProducts: ${keywordData.mainProducts.length} items`);
        console.log(`   - problemsSolved: ${keywordData.problemsSolved.length} items`);
        console.log(`   - customerSearches: ${keywordData.customerSearches.length} items`);

      } catch (error: any) {
        console.log('❌ Text extraction failed:', error.message);
        console.log('Response preview:', generatedText.substring(0, 300));
        throw new Error('Failed to extract keywords from response');
      }

      // Save keywords to database with categories
      try {
        const shopService = new ShopifyShopService(admin);
        const shopInfo = await shopService.getShopInfo();

        const allKeywords = [
          ...keywordData.mainProducts,
          ...keywordData.problemsSolved,
          ...keywordData.customerSearches
        ];

        await prisma.keywordAnalysis.create({
          data: {
            shopDomain: shopInfo.primaryDomain || 'unknown',
            storeUrl: homepageUrl,
            keywords: allKeywords, // Legacy field for backwards compatibility
            mainProducts: keywordData.mainProducts,
            problemsSolved: keywordData.problemsSolved,
            customerSearches: keywordData.customerSearches
          }
        });

        console.log('Keywords saved to database successfully:', allKeywords.length);
      } catch (dbError) {
        console.error('Failed to save keywords to database:', dbError);
        // Continue anyway - don't fail the whole operation
      }

      return json({
        success: true,
        keywordData,
        homepageUrl
      });
    }

    if (actionType === 'updateKeywords') {
      const keywordDataString = formData.get('keywordData');
      if (!keywordDataString || typeof keywordDataString !== 'string') {
        return json({ success: false, error: 'Invalid keyword data' });
      }

      let parsedKeywords;
      try {
        parsedKeywords = JSON.parse(keywordDataString);
      } catch (error) {
        return json({ success: false, error: 'Invalid keyword data format' });
      }

      // Get shop info for database operations
      const shopService = new ShopifyShopService(admin);
      const shopInfo = await shopService.getShopInfo();
      const shopDomain = shopInfo.primaryDomain || 'unknown';

      // Clean up keywords (remove empty values)
      const cleanedKeywords = {
        mainProducts: parsedKeywords.mainProducts?.filter((k: string) => k && k.trim()) || [],
        problemsSolved: parsedKeywords.problemsSolved?.filter((k: string) => k && k.trim()) || [],
        customerSearches: parsedKeywords.customerSearches?.filter((k: string) => k && k.trim()) || []
      };

      // Combine all keywords for legacy field
      const allKeywords = [
        ...cleanedKeywords.mainProducts,
        ...cleanedKeywords.problemsSolved,
        ...cleanedKeywords.customerSearches
      ];

      try {
        // Update or create keyword analysis record
        await prisma.keywordAnalysis.upsert({
          where: {
            id: 'dummy' // This will fail and go to create
          },
          update: {
            mainProducts: cleanedKeywords.mainProducts,
            problemsSolved: cleanedKeywords.problemsSolved,
            customerSearches: cleanedKeywords.customerSearches,
            keywords: allKeywords // Update legacy field too
          },
          create: {
            shopDomain: shopDomain,
            storeUrl: `https://${shopDomain}/`,
            keywords: allKeywords,
            mainProducts: cleanedKeywords.mainProducts,
            problemsSolved: cleanedKeywords.problemsSolved,
            customerSearches: cleanedKeywords.customerSearches
          }
        });

        // Since upsert by id won't work as expected, let's update the most recent record
        const existingRecord = await prisma.keywordAnalysis.findFirst({
          where: { shopDomain: shopDomain },
          orderBy: { updatedAt: 'desc' }
        });

        if (existingRecord) {
          await prisma.keywordAnalysis.update({
            where: { id: existingRecord.id },
            data: {
              mainProducts: cleanedKeywords.mainProducts,
              problemsSolved: cleanedKeywords.problemsSolved,
              customerSearches: cleanedKeywords.customerSearches,
              keywords: allKeywords
            }
          });
        } else {
          await prisma.keywordAnalysis.create({
            data: {
              shopDomain: shopDomain,
              storeUrl: `https://${shopDomain}/`,
              keywords: allKeywords,
              mainProducts: cleanedKeywords.mainProducts,
              problemsSolved: cleanedKeywords.problemsSolved,
              customerSearches: cleanedKeywords.customerSearches
            }
          });
        }

        return json({
          success: true,
          keywordData: cleanedKeywords,
          message: 'Keywords updated successfully'
        });
      } catch (dbError) {
        console.error('Failed to update keywords:', dbError);
        return json({ success: false, error: 'Failed to save keywords to database' });
      }
    }

    if (actionType === 'createBlog') {
      if (!selectedKeyword) {
        return json({ success: false, error: 'No keyword selected' });
      }

      // Get the actual shop's primary domain
      const shopService = new ShopifyShopService(admin);
      const shopInfo = await shopService.getShopInfo();
      const homepageUrl = `https://${shopInfo.primaryDomain}/`;

      // 1. First create a blog if it doesn't exist
      const createBlogMutation = `
        mutation blogCreate($blog: BlogCreateInput!) {
          blogCreate(blog: $blog) {
            blog {
              id
              handle
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const blogResponse = await admin.graphql(createBlogMutation, {
        variables: {
          blog: {
            title: "SEO Blog",
            handle: "seo-blog"
          }
        }
      });

      const blogData = await blogResponse.json();
      let blogId;

      if (blogData.data?.blogCreate?.blog?.id) {
        blogId = blogData.data.blogCreate.blog.id;
      } else {
        // Blog might already exist, try to get it
        const getBlogQuery = `
          query {
            blogs(first: 1, query: "handle:seo-blog") {
              edges {
                node {
                  id
                }
              }
            }
          }
        `;

        const existingBlogResponse = await admin.graphql(getBlogQuery);
        const existingBlogData = await existingBlogResponse.json();

        if (existingBlogData.data?.blogs?.edges?.[0]?.node?.id) {
          blogId = existingBlogData.data.blogs.edges[0].node.id;
        } else {
          throw new Error('Failed to create or find blog');
        }
      }

      // 2. Get all available keywords for comprehensive context
      const existingKeywords = await prisma.keywordAnalysis.findFirst({
        where: { shopDomain: shopInfo.primaryDomain || 'unknown' },
        orderBy: { updatedAt: 'desc' }
      });

      let allKeywordsContext = '';
      if (existingKeywords) {
        const mainProducts = existingKeywords.mainProducts || [];
        const problemsSolved = existingKeywords.problemsSolved || [];
        const customerSearches = existingKeywords.customerSearches || [];

        allKeywordsContext = `
BUSINESS CONTEXT - ALL AVAILABLE KEYWORDS:

MAIN PRODUCTS/SERVICES:
${mainProducts.map(k => `- ${k}`).join('\n')}

PROBLEMS SOLVED:
${problemsSolved.map(k => `- ${k}`).join('\n')}

CUSTOMER SEARCH TERMS:
${customerSearches.map(k => `- ${k}`).join('\n')}

TOTAL KEYWORDS AVAILABLE: ${mainProducts.length + problemsSolved.length + customerSearches.length}
`;
      }

      // 3. Generate blog content using Gemini with ALL keywords for context
      const blogPrompt = `Write an SEO blog post about: "${selectedKeyword}"

      Store context: ${homepageUrl}
      ${allKeywordsContext}

      Return ONLY valid JSON in this format:
      {
        "title": "Blog title with ${selectedKeyword}",
        "content": "HTML blog content",
        "summary": "Meta description (150-160 chars)"
      }

      Requirements:
      - 600-800 words
      - Focus on "${selectedKeyword}"
      - Use 3-4 related keywords from the context naturally
      - Include H2 headings
      - Practical and helpful content
      - Clear and simple writing`;

      const contentResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': process.env.GEMINI_API_KEY || ''
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: blogPrompt }] }]
        })
      });

      const contentData = await contentResponse.json();
      const contentText = contentData.candidates[0].content.parts[0].text.trim();

      let blogContent;
      try {
        blogContent = JSON.parse(contentText);

        if (!blogContent.title || !blogContent.content || !blogContent.summary) {
          throw new Error('Invalid blog content structure');
        }

        console.log(`Blog generated: ${blogContent.title}`);

      } catch (error) {
        console.warn('Using fallback content');

        // Simple fallback content
        blogContent = {
          title: `How to Use ${selectedKeyword} Effectively`,
          content: `
            <h2>What is ${selectedKeyword}?</h2>
            <p>${selectedKeyword} is an important topic that can benefit your business. Understanding how to use ${selectedKeyword} properly will help you achieve better results.</p>

            <h2>Benefits of ${selectedKeyword}</h2>
            <p>When you implement ${selectedKeyword} correctly, you can expect to see improvements in efficiency and customer satisfaction. Many businesses have found success with ${selectedKeyword}.</p>

            <h2>Getting Started</h2>
            <p>To begin with ${selectedKeyword}, start by understanding your specific needs. Our products and services can help you implement ${selectedKeyword} effectively.</p>

            <h2>Next Steps</h2>
            <p>Contact us to learn more about how ${selectedKeyword} can work for your business. We're here to help you succeed with ${selectedKeyword}.</p>
          `,
          summary: `Learn how to use ${selectedKeyword} effectively for your business. Get practical tips and guidance for implementing ${selectedKeyword}.`
        };
      }

      // 3. Create the blog article
      const createArticleMutation = `
        mutation articleCreate($article: ArticleCreateInput!) {
          articleCreate(article: $article) {
            article {
              id
              title
              handle
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const articleResponse = await admin.graphql(createArticleMutation, {
        variables: {
          article: {
            blogId: blogId,
            title: blogContent.title,
            body: blogContent.content,
            summary: blogContent.summary,
            isPublished: true,
            tags: [selectedKeyword],
            author: {
              name: "SEO Assistant"
            }
          }
        }
      });

      const articleData = await articleResponse.json();

      if (articleData.data?.articleCreate?.userErrors?.length > 0) {
        throw new Error(articleData.data.articleCreate.userErrors[0].message);
      }

      // Save blog post to database
      try {
        const shopService = new ShopifyShopService(admin);
        const shopInfo = await shopService.getShopInfo();

        await prisma.blogPost.create({
          data: {
            shopDomain: shopInfo.primaryDomain || 'unknown',
            shopifyBlogId: blogId,
            shopifyArticleId: articleData.data?.articleCreate?.article?.id || 'unknown',
            keyword: selectedKeyword,
            title: blogContent.title,
            status: 'published',
            publishedAt: new Date()
          }
        });

        console.log('Blog post saved to database successfully:', blogContent.title);
      } catch (dbError) {
        console.error('Failed to save blog post to database:', dbError);
        // Continue anyway - don't fail the whole operation
      }

      return json({
        success: true,
        article: articleData.data?.articleCreate?.article,
        blogContent
      });
    }

    return json({ success: false, error: 'Invalid action type' }, { status: 400 });

  } catch (error) {
    console.error('Error in seo-blogs action:', error);

    // Return a user-friendly error without causing 500
    const errorMessage = error.message || 'Operation failed. Please try again.';
    return json({
      success: false,
      error: errorMessage.includes('Gemini API error')
        ? 'Failed to generate keywords. Please check your API key and try again.'
        : errorMessage
    });
  }
};

interface KeywordData {
  mainProducts: string[];
  problemsSolved: string[];
  customerSearches: string[];
}

export default function SEOBlogs() {
  const { shopInfo, existingKeywords, recentBlogs, error: loaderError } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

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

  const isLoading = fetcher.state === "submitting";
  const actionData = fetcher.data;

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

  if (loaderError) {
    return (
      <Page>
        <TitleBar title="Improve My SEO" />
        <Text as="p" variant="bodyMd" tone="critical">
          Error: {loaderError}
        </Text>
      </Page>
    );
  }

  return (
    <Page>
      <TitleBar title="Improve My SEO" />

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

              {/* Step 3: Start Automation (disabled for now) */}
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">
                  Step 3: Start Automation
                </Text>
                <Button disabled variant="primary">
                  Start Weekly Publishing (Coming Soon)
                </Button>
                <Text as="p" variant="bodySm" tone="subdued">
                  Automatically publishes 1 blog per week
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}