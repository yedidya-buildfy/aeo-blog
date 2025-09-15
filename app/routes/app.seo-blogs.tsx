import { useState } from "react";
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
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { GeminiService } from "../services/gemini.service";
import { ShopifyShopService } from "../services/shopify-shop.service";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { admin } = await authenticate.admin(request);
    const shopService = new ShopifyShopService(admin);
    const shopInfo = await shopService.getShopInfo();

    return json({
      shopInfo,
      error: null
    });
  } catch (error) {
    console.error('Error in seo-blogs loader:', error);
    return json({
      shopInfo: null,
      error: 'Failed to load shop information'
    });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const actionType = formData.get('actionType');
  const selectedKeyword = formData.get('keyword');

  try {
    const { admin } = await authenticate.admin(request);
    const shopService = new ShopifyShopService(admin);
    const geminiService = new GeminiService();

    if (actionType === 'findKeywords') {
      // Use live store for testing instead of dev store
      const homepageUrl = 'https://drive-buddy.com/';

      // Generate keywords using Gemini
      const keywordPrompt = `Analyze this Shopify store: ${homepageUrl}

      Generate 15-20 SEO keywords that would be perfect for blog content to improve this store's search ranking.

      Return only a JSON array of keywords like this:
      ["keyword 1", "keyword 2", "keyword 3"]

      Focus on:
      - Product-related keywords
      - Industry terms
      - Long-tail keywords for blog content
      - Local SEO terms if applicable`;

      const requestBody = {
        contents: [{ parts: [{ text: keywordPrompt }] }]
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
        throw new Error(`Gemini API error: ${response.status}`);
      }

      const data = await response.json();
      const generatedText = data.candidates[0].content.parts[0].text.trim();

      // Parse JSON from response
      let keywords;
      try {
        keywords = JSON.parse(generatedText);
      } catch {
        // Fallback if not valid JSON
        keywords = generatedText.split('\n').filter(k => k.trim()).slice(0, 15);
      }

      return json({
        success: true,
        keywords,
        homepageUrl
      });
    }

    if (actionType === 'createBlog') {
      if (!selectedKeyword) {
        return json({ success: false, error: 'No keyword selected' });
      }

      // Use live store for testing instead of dev store
      const homepageUrl = 'https://drive-buddy.com/';

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

      // 2. Generate blog content using Gemini
      const blogPrompt = `Write a complete SEO-optimized blog post for this keyword: "${selectedKeyword}"

      Store context: ${homepageUrl}

      Return ONLY valid JSON in this exact format:
      {
        "title": "Blog post title",
        "content": "Full HTML blog content with proper headings, paragraphs, and SEO optimization",
        "summary": "Brief summary for meta description"
      }

      Requirements:
      - 800-1200 words
      - Use H2 and H3 headings
      - Include the keyword naturally
      - Add internal linking opportunities
      - SEO-optimized content`;

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
      } catch {
        // Fallback content
        blogContent = {
          title: `How to Use ${selectedKeyword} for Better Results`,
          content: `<h2>Introduction</h2><p>This blog post discusses ${selectedKeyword} and its importance for your business.</p>`,
          summary: `Learn about ${selectedKeyword} and how it can benefit your business.`
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
            contentHtml: blogContent.content,
            summary: blogContent.summary,
            published: true,
            tags: [selectedKeyword]
          }
        }
      });

      const articleData = await articleResponse.json();

      if (articleData.data?.articleCreate?.userErrors?.length > 0) {
        throw new Error(articleData.data.articleCreate.userErrors[0].message);
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
    return json({
      success: false,
      error: error.message || 'Operation failed. Please try again.'
    }, { status: 500 });
  }
};

export default function SEOBlogs() {
  const { shopInfo, error: loaderError } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [keywords, setKeywords] = useState<string[]>([]);
  const [selectedKeyword, setSelectedKeyword] = useState<string>('');
  const [createdBlog, setCreatedBlog] = useState<any>(null);

  const isLoading = fetcher.state === "submitting";
  const actionData = fetcher.data;

  // Handle action completion
  if (actionData && actionData.success && actionData.keywords) {
    if (keywords.length === 0) {
      setKeywords(actionData.keywords);
      shopify.toast.show("Keywords found successfully!");
    }
  } else if (actionData && actionData.success && actionData.article) {
    if (!createdBlog) {
      setCreatedBlog(actionData.article);
      shopify.toast.show("Blog created successfully!");
    }
  } else if (actionData && !actionData.success) {
    shopify.toast.show(`Error: ${actionData.error}`, { isError: true });
  }

  const handleFindKeywords = () => {
    const formData = new FormData();
    formData.append('actionType', 'findKeywords');
    fetcher.submit(formData, { method: 'POST' });
  };

  const handleCreateBlog = () => {
    if (!selectedKeyword) {
      shopify.toast.show("Please select a keyword first", { isError: true });
      return;
    }

    const formData = new FormData();
    formData.append('actionType', 'createBlog');
    formData.append('keyword', selectedKeyword);
    fetcher.submit(formData, { method: 'POST' });
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

              {/* Step 1: Find Keywords */}
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">
                  Step 1: Find Keywords
                </Text>

                <Button
                  variant="primary"
                  size="large"
                  onClick={handleFindKeywords}
                  loading={isLoading}
                  disabled={keywords.length > 0}
                >
                  {isLoading ? 'Finding Keywords...' :
                   keywords.length > 0 ? 'Keywords Found' : 'Find Keywords'}
                </Button>

                {keywords.length > 0 && (
                  <Card background="bg-surface-secondary">
                    <BlockStack gap="200">
                      <Text as="h4" variant="headingMd">
                        Found Keywords ({keywords.length})
                      </Text>
                      <BlockStack gap="200">
                        {keywords.map((keyword, index) => (
                          <Button
                            key={index}
                            variant={selectedKeyword === keyword ? "primary" : "secondary"}
                            size="slim"
                            onClick={() => setSelectedKeyword(keyword)}
                          >
                            {keyword}
                          </Button>
                        ))}
                      </BlockStack>
                      {selectedKeyword && (
                        <Text as="p" variant="bodySm" tone="success">
                          Selected: {selectedKeyword}
                        </Text>
                      )}
                    </BlockStack>
                  </Card>
                )}
              </BlockStack>

              {/* Step 2: Initialize SEO */}
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">
                  Step 2: Initialize SEO
                </Text>
                <Button
                  disabled={!selectedKeyword}
                  variant="primary"
                  loading={isLoading && fetcher.formData?.get('actionType') === 'createBlog'}
                  onClick={handleCreateBlog}
                >
                  {isLoading && fetcher.formData?.get('actionType') === 'createBlog'
                    ? 'Creating Blog...'
                    : 'Create 1 Blog (Test)'}
                </Button>
                <Text as="p" variant="bodySm" tone="subdued">
                  Creates 1 SEO blog from selected keyword
                </Text>

                {createdBlog && (
                  <Card background="bg-surface-success">
                    <BlockStack gap="200">
                      <Text as="h4" variant="headingMd" tone="success">
                        Blog Created Successfully!
                      </Text>
                      <Text as="p" variant="bodyMd">
                        Title: {createdBlog.title}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        ID: {createdBlog.id}
                      </Text>
                    </BlockStack>
                  </Card>
                )}
              </BlockStack>

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