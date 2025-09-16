import type { AdminApiContext } from '@shopify/shopify-app-remix/server';
import type { GeneratedBlog } from './blog-generator.service';

export interface ShopifyBlogResult {
  success: boolean;
  blog?: {
    id: string;
    handle: string;
    title: string;
    url?: string;
  };
  article?: {
    id: string;
    handle: string;
    title: string;
    url?: string;
  };
  error?: string;
}

export interface BlogCreationRequest {
  generatedBlog: GeneratedBlog;
  blogTitle?: string;
  blogHandle?: string;
  published?: boolean;
}

export class ShopifyBlogService {
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 1000; // 1 second
  private readonly DEFAULT_BLOG_TITLE = 'SEO Blog';
  private readonly DEFAULT_BLOG_HANDLE = 'seo-blog';

  constructor(private admin: AdminApiContext) {}

  /**
   * Create and publish a complete blog post
   */
  async createAndPublishBlog(request: BlogCreationRequest): Promise<ShopifyBlogResult> {
    try {
      console.log(`[ShopifyBlog] Creating blog post: ${request.generatedBlog.title}`);

      // Step 1: Ensure blog container exists
      const blogResult = await this.ensureBlogExists(
        request.blogTitle || this.DEFAULT_BLOG_TITLE,
        request.blogHandle || this.DEFAULT_BLOG_HANDLE
      );

      if (!blogResult.success || !blogResult.blog) {
        return {
          success: false,
          error: blogResult.error || 'Failed to create/find blog container'
        };
      }

      // Step 2: Create and publish the blog post
      const articleResult = await this.createBlogPost(
        blogResult.blog.id,
        request.generatedBlog,
        request.published !== false // Default to published
      );

      if (!articleResult.success) {
        return {
          success: false,
          blog: blogResult.blog,
          error: articleResult.error
        };
      }

      console.log(`[ShopifyBlog] Successfully created blog post: ${articleResult.article?.id}`);

      return {
        success: true,
        blog: blogResult.blog,
        article: articleResult.article
      };

    } catch (error) {
      console.error('[ShopifyBlog] Error in createAndPublishBlog:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Find existing blog or create new one
   */
  private async ensureBlogExists(title: string, handle: string): Promise<ShopifyBlogResult> {
    try {
      // First, try to find existing blog
      const existingBlog = await this.findBlogByHandle(handle);
      if (existingBlog) {
        console.log(`[ShopifyBlog] Using existing blog: ${existingBlog.id}`);
        return {
          success: true,
          blog: existingBlog
        };
      }

      // Create new blog if not found
      return await this.createBlog(title, handle);

    } catch (error) {
      console.error('[ShopifyBlog] Error ensuring blog exists:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to ensure blog exists'
      };
    }
  }

  /**
   * Find blog by handle
   */
  private async findBlogByHandle(handle: string) {
    const query = `
      query findBlog($handle: String!) {
        blogs(first: 1, query: $handle) {
          nodes {
            id
            handle
            title
          }
        }
      }
    `;

    const response = await this.executeWithRetry(query, { handle });
    const blogs = response.data?.blogs?.nodes;

    return blogs && blogs.length > 0 ? blogs[0] : null;
  }

  /**
   * Create new blog container
   */
  private async createBlog(title: string, handle: string): Promise<ShopifyBlogResult> {
    const mutation = `
      mutation blogCreate($blog: BlogInput!) {
        blogCreate(blog: $blog) {
          blog {
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

    const variables = {
      blog: {
        title,
        handle
      }
    };

    try {
      const response = await this.executeWithRetry(mutation, variables);

      if (response.data?.blogCreate?.userErrors?.length > 0) {
        const error = response.data.blogCreate.userErrors[0].message;
        console.error('[ShopifyBlog] Blog creation error:', error);
        return {
          success: false,
          error: `Failed to create blog: ${error}`
        };
      }

      const blog = response.data?.blogCreate?.blog;
      if (!blog) {
        return {
          success: false,
          error: 'Blog creation failed - no blog returned'
        };
      }

      console.log(`[ShopifyBlog] Created new blog: ${blog.id}`);
      return {
        success: true,
        blog
      };

    } catch (error) {
      console.error('[ShopifyBlog] Error creating blog:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create blog'
      };
    }
  }

  /**
   * Create blog post/article
   */
  private async createBlogPost(
    blogId: string,
    generatedBlog: GeneratedBlog,
    published: boolean
  ): Promise<ShopifyBlogResult> {
    const mutation = `
      mutation articleCreate($article: ArticleCreateInput!) {
        articleCreate(article: $article) {
          article {
            id
            title
            handle
            publishedAt
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      article: {
        blogId: blogId,
        title: generatedBlog.title,
        body: generatedBlog.content,
        handle: generatedBlog.handle,
        isPublished: published,
        summary: generatedBlog.summary,
        tags: generatedBlog.tags,
        author: {
          name: "SEO Assistant"
        }
      }
    };

    try {
      const response = await this.executeWithRetry(mutation, variables);

      if (response.data?.articleCreate?.userErrors?.length > 0) {
        const error = response.data.articleCreate.userErrors[0].message;
        console.error('[ShopifyBlog] Article creation error:', error);
        return {
          success: false,
          error: `Failed to create blog post: ${error}`
        };
      }

      const article = response.data?.articleCreate?.article;
      if (!article) {
        return {
          success: false,
          error: 'Article creation failed - no article returned'
        };
      }

      return {
        success: true,
        article
      };

    } catch (error) {
      console.error('[ShopifyBlog] Error creating article:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create article'
      };
    }
  }

  /**
   * Execute GraphQL query/mutation with retry logic
   */
  private async executeWithRetry(
    query: string,
    variables: any,
    attempt: number = 1
  ): Promise<any> {
    try {
      const response = await this.admin.graphql(query, { variables });
      return await response.json();

    } catch (error) {
      console.error(`[ShopifyBlog] GraphQL error (attempt ${attempt}):`, error);

      // Check if we should retry
      if (attempt < this.MAX_RETRIES && this.isRetryableError(error)) {
        console.log(`[ShopifyBlog] Retrying in ${this.RETRY_DELAY}ms...`);
        await this.sleep(this.RETRY_DELAY * attempt); // Exponential backoff
        return this.executeWithRetry(query, variables, attempt + 1);
      }

      throw error;
    }
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(error: any): boolean {
    if (!error) return false;

    // Network errors
    if (error.name === 'TypeError' || error.code === 'ECONNRESET') {
      return true;
    }

    // Rate limiting
    if (error.status === 429) {
      return true;
    }

    // Server errors
    if (error.status >= 500) {
      return true;
    }

    // Timeout errors
    if (error.code === 'ETIMEDOUT') {
      return true;
    }

    return false;
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get blog statistics
   */
  async getBlogStatistics(blogHandle: string = this.DEFAULT_BLOG_HANDLE) {
    try {
      const query = `
        query getBlogStats($handle: String!) {
          blogs(first: 1, query: $handle) {
            nodes {
              id
              handle
              title
              articles(first: 250) {
                nodes {
                  id
                  title
                  publishedAt
                  handle
                }
              }
            }
          }
        }
      `;

      const response = await this.executeWithRetry(query, { handle: blogHandle });
      const blog = response.data?.blogs?.nodes?.[0];

      if (!blog) {
        return {
          exists: false,
          totalArticles: 0,
          recentArticles: []
        };
      }

      const articles = blog.articles.nodes || [];
      const recentArticles = articles
        .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
        .slice(0, 10);

      return {
        exists: true,
        blogId: blog.id,
        totalArticles: articles.length,
        recentArticles,
        lastPublished: articles.length > 0 ? recentArticles[0].publishedAt : null
      };

    } catch (error) {
      console.error('[ShopifyBlog] Error getting blog statistics:', error);
      return {
        exists: false,
        totalArticles: 0,
        recentArticles: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}