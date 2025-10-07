import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { GeminiService } from "../services/gemini.service";
import { ShopifyShopService } from "../services/shopify-shop.service";
import { AutomationSchedulerService } from "../services/automation-scheduler.service";
import { KeywordAggregationService } from "../services/keyword-aggregation.service";
import { AITopicGeneratorService } from "../services/ai-topic-generator.service";
import { BlogGeneratorService } from "../services/blog-generator.service";
import { ShopifyBlogService } from "../services/shopify-blog.service";
import { BillingService } from "../services/billing.service";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    // Authenticate the request
    const { admin } = await authenticate.admin(request);
    const shopService = new ShopifyShopService(admin);

    // Get the actual shop domain and homepage URL
    const shopInfo = await shopService.getShopInfo();
    const shopDomain = shopInfo.primaryDomain;
    const homepageUrl = `https://${shopDomain}`;

    console.log(`[WizardSetup] Starting complete setup for ${shopDomain}`);

    // Step 1: Generate keywords
    console.log(`[WizardSetup] Step 1: Generating keywords`);

    const geminiService = new GeminiService();

    // Generate keywords using Gemini with URL context
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

    const requestBody = {
      contents: [{ parts: [{ text: keywordPrompt }] }],
      tools: [{ url_context: {} }]
    };

    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': process.env.GEMINI_API_KEY || ''
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error(`Failed to generate keywords: ${response.status}`);
    }

    const data = await response.json();
    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

    // Use fallback keywords if Gemini fails
    let keywordData;
    if (!generatedText || generatedText.length < 50) {
      console.log(`[WizardSetup] Using fallback keywords for ${shopDomain}`);
      keywordData = {
        mainProducts: ['online store', 'ecommerce', 'retail products', 'digital goods'],
        problemsSolved: ['convenient shopping', 'product discovery', 'secure checkout', 'fast delivery'],
        customerSearches: ['buy online', 'shop now', 'best products', 'online deals']
      };
    } else {
      // Try to extract keywords from Gemini response
      try {
        keywordData = extractKeywordsFromText(generatedText);
      } catch (error) {
        console.log(`[WizardSetup] Keyword extraction failed, using fallback`);
        keywordData = {
          mainProducts: ['online store', 'ecommerce', 'retail products'],
          problemsSolved: ['convenient shopping', 'product discovery', 'secure checkout'],
          customerSearches: ['buy online', 'shop now', 'best products']
        };
      }
    }

    // Save keywords to database
    const allKeywords = [
      ...keywordData.mainProducts,
      ...keywordData.problemsSolved,
      ...keywordData.customerSearches
    ];

    await prisma.keywordAnalysis.create({
      data: {
        shopDomain: shopDomain,
        storeUrl: homepageUrl,
        keywords: allKeywords,
        mainProducts: keywordData.mainProducts,
        problemsSolved: keywordData.problemsSolved,
        customerSearches: keywordData.customerSearches
      }
    });

    console.log(`[WizardSetup] Step 1 complete: Saved ${allKeywords.length} keywords`);

    // Step 2: Generate first blog post
    console.log(`[WizardSetup] Step 2: Generating first blog post`);

    // Check billing and plan limits
    const billingService = new BillingService(prisma, admin);
    const canGenerate = await billingService.canGenerateBlog(shopDomain);
    const subscription = await billingService.getSubscription(shopDomain);
    const currentPlan = subscription?.plan || 'free';

    // Determine number of blogs to generate based on plan
    let totalBlogsToGenerate = 1; // Default for free plan
    if (currentPlan === 'starter') {
      totalBlogsToGenerate = 1;
    } else if (currentPlan === 'pro') {
      totalBlogsToGenerate = 3; // Pro gets 3 blogs total
    }

    console.log(`[WizardSetup] Plan: ${currentPlan}, total blogs: ${totalBlogsToGenerate}, can generate: ${canGenerate}`);

    let firstBlogGenerated = false;

    if (!canGenerate) {
      console.log(`[WizardSetup] Blog generation skipped - billing limit reached`);
    } else {
      // Get keyword context for blog generation
      const keywordService = new KeywordAggregationService(prisma);
      const keywordContext = await keywordService.getKeywordContextForGeneration(shopDomain);

      // Generate FIRST blog synchronously (needed for wizard completion)
      try {
        console.log(`[WizardSetup] Generating first blog (synchronous)`);

        // Generate blog prompt
        const topicGenerator = new AITopicGeneratorService(prisma);
        const blogPrompt = await topicGenerator.generateUniqueBlogPrompt(shopDomain, keywordContext, homepageUrl);

        // Generate blog content
        const blogGenerator = new BlogGeneratorService();
        const blogContent = await blogGenerator.generateBlog({
          prompt: blogPrompt,
          keywordContext: keywordContext,
          storeUrl: homepageUrl
        });

        // Publish to Shopify
        const shopifyBlogService = new ShopifyBlogService(admin);
        const publishedBlog = await shopifyBlogService.createAndPublishBlog({
          generatedBlog: blogContent,
          published: true
        });

        // Save to database
        await prisma.blogPost.create({
          data: {
            shopDomain: shopDomain,
            shopifyBlogId: publishedBlog.blog?.id || 'unknown',
            shopifyArticleId: publishedBlog.article?.id || 'unknown',
            keyword: blogPrompt.primaryTopic || blogContent.title || 'Generated Blog',
            title: blogContent.title,
            status: 'published',
            publishedAt: new Date(),
            contentAngle: blogPrompt.contentAngle || 'General',
            contentHash: blogPrompt.contentHash || '',
            handle: blogPrompt.handle || '',
            keywordsFocused: blogPrompt.keywordsFocused || [],
            primaryTopic: blogPrompt.primaryTopic || blogContent.title || 'General Topic'
          }
        });

        // Increment usage for billing tracking
        await billingService.incrementBlogUsage(shopDomain);

        firstBlogGenerated = true;
        console.log(`[WizardSetup] First blog generated: "${blogContent.title}"`);

      } catch (blogError) {
        console.error(`[WizardSetup] Error generating first blog:`, blogError);
      }

      // Generate remaining blogs in BACKGROUND (non-blocking)
      const remainingBlogs = totalBlogsToGenerate - 1;
      if (remainingBlogs > 0 && firstBlogGenerated) {
        console.log(`[WizardSetup] Starting background generation of ${remainingBlogs} remaining blogs`);

        // Fire and forget - don't await this
        generateRemainingBlogsInBackground(
          shopDomain,
          homepageUrl,
          remainingBlogs,
          keywordContext,
          admin,
          prisma,
          billingService
        ).catch(err => {
          console.error(`[WizardSetup] Background blog generation error:`, err);
        });
      }

      console.log(`[WizardSetup] Step 2 complete: First blog created, ${remainingBlogs} blogs queued for background generation`);
    }

    // Step 3: Enable weekly automation
    console.log(`[WizardSetup] Step 3: Enabling weekly automation`);

    const automationService = new AutomationSchedulerService(prisma);
    await automationService.enableAutomation(shopDomain, 0, 10); // Sunday, 10 AM

    console.log(`[WizardSetup] Step 3 complete: Weekly automation enabled`);

    // Step 4: Mark wizard as completed in Shopify metafields
    console.log(`[WizardSetup] Step 4: Marking wizard as completed`);

    try {
      const wizardCompleted = await shopService.setWizardState({
        completed: true,
        step: 3,
        completedAt: new Date().toISOString()
      });

      if (wizardCompleted) {
        console.log(`[WizardSetup] Step 4 complete: Wizard state saved`);
      } else {
        console.log(`[WizardSetup] Step 4 warning: Failed to save wizard state`);
      }
    } catch (error) {
      console.error(`[WizardSetup] Step 4 error: Failed to save wizard state:`, error);
      // Don't fail the whole setup for this
    }

    return json({
      success: true,
      message: 'Setup completed successfully!',
      keywordCount: allKeywords.length,
      blogsGenerated: 1, // First blog generated, rest in background
      plan: currentPlan,
      automationEnabled: true,
      wizardCompleted: true,
      // Progress flags for UI
      keywordsFound: true,
      firstBlogGenerated: firstBlogGenerated,
    });

  } catch (error) {
    console.error('[WizardSetup] Error:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Setup failed. Please try again.'
    }, { status: 500 });
  }
};

// Helper function to extract keywords from text
function extractKeywordsFromText(text: string) {
  const keywords = {
    mainProducts: [] as string[],
    problemsSolved: [] as string[],
    customerSearches: [] as string[]
  };

  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  let currentCategory = '';

  for (const line of lines) {
    // Detect section headers
    if (line.toUpperCase().includes('MAIN PRODUCTS') || line.toUpperCase().includes('PRODUCTS')) {
      currentCategory = 'mainProducts';
      continue;
    }
    if (line.toUpperCase().includes('PROBLEMS') || line.toUpperCase().includes('SOLVE')) {
      currentCategory = 'problemsSolved';
      continue;
    }
    if (line.toUpperCase().includes('CUSTOMERS') || line.toUpperCase().includes('SEARCH')) {
      currentCategory = 'customerSearches';
      continue;
    }

    // Extract keywords from current line
    const extractedKeywords = extractKeywordsFromLine(line);

    // Add to appropriate category
    if (currentCategory && extractedKeywords.length > 0) {
      keywords[currentCategory as keyof typeof keywords].push(...extractedKeywords);
    }
  }

  // Ensure minimum keywords per category
  if (keywords.mainProducts.length === 0) {
    keywords.mainProducts = ['products', 'services', 'solutions'];
  }
  if (keywords.problemsSolved.length === 0) {
    keywords.problemsSolved = ['problem solving', 'assistance', 'support'];
  }
  if (keywords.customerSearches.length === 0) {
    keywords.customerSearches = ['find products', 'search', 'buy now'];
  }

  // Remove duplicates and limit
  keywords.mainProducts = [...new Set(keywords.mainProducts)].slice(0, 6);
  keywords.problemsSolved = [...new Set(keywords.problemsSolved)].slice(0, 6);
  keywords.customerSearches = [...new Set(keywords.customerSearches)].slice(0, 6);

  return keywords;
}

function extractKeywordsFromLine(line: string): string[] {
  const keywords: string[] = [];

  // Bullet point content
  if (line.includes('*') || line.includes('•') || line.includes('-')) {
    const bulletContent = line.replace(/[*•-]\s*/, '').trim();
    if (bulletContent.length > 2) {
      keywords.push(bulletContent.split(/[:\(\)]/)[0].trim());
    }
  }

  // Quoted terms
  const quotedMatches = line.match(/"([^"]+)"/g) || [];
  keywords.push(...quotedMatches.map(k => k.replace(/"/g, '').trim()));

  return keywords.filter(k => k && k.length > 2 && k.length < 50);
}

// Background blog generation function (non-blocking)
async function generateRemainingBlogsInBackground(
  shopDomain: string,
  homepageUrl: string,
  remainingCount: number,
  keywordContext: any,
  admin: any,
  prisma: any,
  billingService: any
) {
  console.log(`[BackgroundGen] Starting generation of ${remainingCount} blogs for ${shopDomain}`);

  for (let i = 0; i < remainingCount; i++) {
    try {
      console.log(`[BackgroundGen] Generating blog ${i + 1}/${remainingCount}`);

      // Generate blog prompt
      const topicGenerator = new AITopicGeneratorService(prisma);
      const blogPrompt = await topicGenerator.generateUniqueBlogPrompt(shopDomain, keywordContext, homepageUrl);

      // Generate blog content
      const blogGenerator = new BlogGeneratorService();
      const blogContent = await blogGenerator.generateBlog({
        prompt: blogPrompt,
        keywordContext: keywordContext,
        storeUrl: homepageUrl
      });

      // Publish to Shopify
      const shopifyBlogService = new ShopifyBlogService(admin);
      const publishedBlog = await shopifyBlogService.createAndPublishBlog({
        generatedBlog: blogContent,
        published: true
      });

      // Save to database
      await prisma.blogPost.create({
        data: {
          shopDomain: shopDomain,
          shopifyBlogId: publishedBlog.blog?.id || 'unknown',
          shopifyArticleId: publishedBlog.article?.id || 'unknown',
          keyword: blogPrompt.primaryTopic || blogContent.title || 'Generated Blog',
          title: blogContent.title,
          status: 'published',
          publishedAt: new Date(),
          contentAngle: blogPrompt.contentAngle || 'General',
          contentHash: blogPrompt.contentHash || '',
          handle: blogPrompt.handle || '',
          keywordsFocused: blogPrompt.keywordsFocused || [],
          primaryTopic: blogPrompt.primaryTopic || blogContent.title || 'General Topic'
        }
      });

      // Increment usage for billing tracking
      await billingService.incrementBlogUsage(shopDomain);

      console.log(`[BackgroundGen] Blog ${i + 1}/${remainingCount} generated: "${blogContent.title}"`);

      // Add delay between blogs to avoid rate limits
      if (i < remainingCount - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

    } catch (blogError) {
      console.error(`[BackgroundGen] Error generating blog ${i + 1}/${remainingCount}:`, blogError);
      // Continue with next blog instead of failing entirely
    }
  }

  console.log(`[BackgroundGen] Completed generation of ${remainingCount} blogs for ${shopDomain}`);
}