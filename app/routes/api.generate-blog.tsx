import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { KeywordAggregationService } from "../services/keyword-aggregation.service";
import { AITopicGeneratorService } from "../services/ai-topic-generator.service";
import { BlogGeneratorService } from "../services/blog-generator.service";
import { ShopifyBlogService } from "../services/shopify-blog.service";
import { ShopifyShopService } from "../services/shopify-shop.service";
import { BillingService } from "../services/billing.service";
import prisma from "../db.server";

// Rate limiting storage (in production, use Redis or database)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_REQUESTS = 20; // 20 requests for development
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour

// Only allow POST requests
export const loader = async ({ request }: LoaderFunctionArgs) => {
  return json({ error: "Method not allowed" }, { status: 405 });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  let shopDomain = '';

  try {
    // Step 1: Authentication
    const { admin } = await authenticate.admin(request);

    // Get shop information
    const shopService = new ShopifyShopService(admin);
    const shopInfo = await shopService.getShopInfo();
    shopDomain = shopInfo.primaryDomain || 'unknown';

    // Step 2: Check billing limits
    const billingService = new BillingService(prisma, admin);
    const canGenerate = await billingService.canGenerateBlog(shopDomain);

    if (!canGenerate) {
      const usage = await billingService.getUsage(shopDomain);
      const subscription = await billingService.getSubscription(shopDomain);

      console.log(`[GenerateBlog] Blog limit exceeded for ${shopDomain}: ${usage.blogsGenerated}/${usage.blogLimit}`);
      return json({
        success: false,
        error: `You've reached your weekly blog limit (${usage.blogsGenerated}/${usage.blogLimit}). Upgrade your plan to generate more blogs.`,
        blogLimitExceeded: true,
        currentPlan: subscription?.plan || 'free',
        usage: {
          blogsGenerated: usage.blogsGenerated,
          blogLimit: usage.blogLimit
        }
      }, { status: 429 });
    }

    // Step 3: Rate limiting
    const rateLimitResult = checkRateLimit(shopDomain);
    if (!rateLimitResult.allowed) {
      console.log(`[GenerateBlog] Rate limit exceeded for ${shopDomain}`);
      return json({
        success: false,
        error: `Rate limit exceeded. Try again in ${Math.ceil(rateLimitResult.resetIn! / 60000)} minutes.`,
        rateLimitExceeded: true
      }, { status: 429 });
    }

    console.log(`[GenerateBlog] Starting blog generation for ${shopDomain}`);

    // Step 4: Get aggregated keywords
    const keywordService = new KeywordAggregationService(prisma);
    const keywordContext = await keywordService.getKeywordContextForGeneration(shopDomain);

    console.log(`[GenerateBlog] Keyword stats:`, {
      mainProducts: keywordContext.mainProducts.length,
      problemsSolved: keywordContext.problemsSolved.length,
      customerSearches: keywordContext.customerSearches.length,
      totalKeywords: keywordContext.totalKeywords
    });

    // Require at least 1 keyword in any category
    if (keywordContext.totalKeywords === 0) {
      return json({
        success: false,
        error: "No keywords available. Please generate keywords first using the 'Find Keywords' button above.",
        needsKeywords: true
      }, { status: 400 });
    }

    console.log(`[GenerateBlog] Using ${keywordContext.totalKeywords} keywords for generation`);

    // Step 5: Generate unique blog prompt using AI
    console.log(`[GenerateBlog] Creating AITopicGeneratorService with prisma:`, !!prisma);
    const topicGenerator = new AITopicGeneratorService(prisma);
    console.log(`[GenerateBlog] AITopicGeneratorService created, calling generateUniqueBlogPrompt`);
    const blogPrompt = await topicGenerator.generateUniqueBlogPrompt(shopDomain, keywordContext, `https://${shopDomain}/`);
    console.log(`[GenerateBlog] Generated blog prompt:`, blogPrompt.title);

    if (!blogPrompt.isUnique) {
      console.warn(`[GenerateBlog] Generated blog prompt may not be fully unique for ${shopDomain}`);
    }

    console.log(`[GenerateBlog] Generated prompt: ${blogPrompt.title} (${blogPrompt.contentAngle})`);

    // Step 6: Generate blog content using AI
    const blogGenerator = new BlogGeneratorService();
    const generatedBlog = await blogGenerator.generateBlog({
      prompt: blogPrompt,
      keywordContext,
      storeUrl: `https://${shopDomain}/`,
      brandName: shopInfo.name || undefined
    });

    console.log(`[GenerateBlog] Generated ${generatedBlog.wordCount} words of content`);

    // Step 7: Publish to Shopify
    const shopifyBlogService = new ShopifyBlogService(admin);
    const publishResult = await shopifyBlogService.createAndPublishBlog({
      generatedBlog,
      published: true
    });

    if (!publishResult.success) {
      throw new Error(`Shopify publishing failed: ${publishResult.error}`);
    }

    console.log(`[GenerateBlog] Published to Shopify: ${publishResult.article?.id}`);

<<<<<<< HEAD
    // Step 7: Construct blog URL
    const blogUrl = `https://${shopDomain}/blogs/seo-blog/${generatedBlog.handle}`;

=======
>>>>>>> billing-and-kpi-work
    // Step 8: Save to database for tracking
    const blogRecord = await prisma.blogPost.create({
      data: {
        shopDomain,
        shopifyBlogId: publishResult.blog!.id,
        shopifyArticleId: publishResult.article!.id,
        keyword: blogPrompt.keywordsFocused[0] || 'general',
        title: generatedBlog.title,
        handle: generatedBlog.handle,
        status: 'published',
        url: blogUrl,
        primaryTopic: blogPrompt.primaryTopic,
        keywordsFocused: blogPrompt.keywordsFocused,
        contentHash: blogPrompt.contentHash,
        contentAngle: blogPrompt.contentAngle,
        publishedAt: new Date()
      }
    });

    console.log(`[GenerateBlog] Saved to database: ${blogRecord.id}`);

    // Step 8: Increment blog usage
    await billingService.incrementBlogUsage(shopDomain);
    console.log(`[GenerateBlog] Incremented blog usage for ${shopDomain}`);

    // Step 9: Return success response
    return json({
      success: true,
      blog: {
        id: blogRecord.id,
        title: generatedBlog.title,
        handle: generatedBlog.handle,
        url: blogUrl,
        shopifyBlogId: publishResult.blog!.id,
        shopifyArticleId: publishResult.article!.id,
        contentAngle: blogPrompt.contentAngle,
        keywordsUsed: blogPrompt.keywordsFocused,
        wordCount: generatedBlog.wordCount,
        publishedAt: new Date().toISOString()
      },
      statistics: {
        keywordsUsed: keywordContext.totalKeywords,
        contentAngle: blogPrompt.contentAngle,
        isUnique: blogPrompt.isUnique
      },
      rateLimitRemaining: RATE_LIMIT_REQUESTS - rateLimitResult.currentCount - 1
    }, { status: 200 });

  } catch (error) {
    console.error(`[GenerateBlog] Error for ${shopDomain}:`, error);

    // Rollback rate limit on error
    if (shopDomain) {
      rollbackRateLimit(shopDomain);
    }

    // Handle specific error types
    if (error && typeof error === 'object' && 'status' in error && error.status === 410) {
      return json({
        success: false,
        error: "Authentication failed. Please refresh the page and try again.",
      }, { status: 401 });
    }

    // Gemini API errors
    if (error instanceof Error && error.message.includes('Gemini API')) {
      return json({
        success: false,
        error: "Content generation failed. Please try again in a few minutes.",
        retryable: true
      }, { status: 503 });
    }

    // Shopify API errors
    if (error instanceof Error && (
      error.message.includes('GraphQL') ||
      error.message.includes('Shopify') ||
      error.message.includes('blogCreate') ||
      error.message.includes('blogPostPublish')
    )) {
      return json({
        success: false,
        error: "Failed to publish to Shopify. Please check your store permissions and try again.",
        retryable: true
      }, { status: 503 });
    }

    // Database errors
    if (error instanceof Error && (
      error.message.includes('Prisma') ||
      error.message.includes('database') ||
      error.message.includes('unique constraint')
    )) {
      return json({
        success: false,
        error: "Database error occurred. Please try again.",
        retryable: true
      }, { status: 503 });
    }

    // Generic error
    return json({
      success: false,
      error: error instanceof Error ? error.message : "An unexpected error occurred. Please try again.",
      retryable: true
    }, { status: 500 });
  }
};

/**
 * Simple rate limiting implementation
 */
function checkRateLimit(shopDomain: string): {
  allowed: boolean;
  currentCount: number;
  resetIn?: number
} {
  const now = Date.now();
  const key = `blog-gen-${shopDomain}`;

  let rateData = rateLimitMap.get(key);

  // Initialize or reset if window expired
  if (!rateData || now > rateData.resetTime) {
    rateData = {
      count: 0,
      resetTime: now + RATE_LIMIT_WINDOW
    };
    rateLimitMap.set(key, rateData);
  }

  const allowed = rateData.count < RATE_LIMIT_REQUESTS;

  if (allowed) {
    rateData.count++;
  }

  return {
    allowed,
    currentCount: rateData.count,
    resetIn: allowed ? undefined : rateData.resetTime - now
  };
}

/**
 * Rollback rate limit on error (don't penalize failed requests)
 */
function rollbackRateLimit(shopDomain: string): void {
  const key = `blog-gen-${shopDomain}`;
  const rateData = rateLimitMap.get(key);

  if (rateData && rateData.count > 0) {
    rateData.count--;
  }
}

/**
 * Cleanup old rate limit entries (run periodically)
 */
function cleanupRateLimit(): void {
  const now = Date.now();

  for (const entry of Array.from(rateLimitMap.entries())) {
    const [key, data] = entry;
    if (now > data.resetTime) {
      rateLimitMap.delete(key);
    }
  }
}

// Cleanup every hour
setInterval(cleanupRateLimit, 60 * 60 * 1000);