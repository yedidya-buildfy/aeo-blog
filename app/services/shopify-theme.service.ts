import { AdminApiContext } from "@shopify/shopify-app-remix/server";

interface GraphQLResponse {
  data?: any;
  errors?: Array<{ message: string; field?: string[] }>;
}

export class ShopifyThemeService {
  constructor(private admin: AdminApiContext) {}

  async getPublishedThemeId(): Promise<string> {
    const query = `
      query {
        themes(first: 20) {
          nodes {
            id
            name
            role
          }
        }
      }
    `;

    const response = await this.admin.graphql(query);
    const data: GraphQLResponse = await response.json();

    if (data.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
    }

    const themes = data.data?.themes?.nodes || [];
    const publishedTheme = themes.find((theme: any) => theme.role === 'MAIN');
    
    if (!publishedTheme) {
      throw new Error('No published theme found');
    }

    return publishedTheme.id;
  }

  async getAsset(themeId: string, key: string): Promise<{ key: string; value: string } | null> {
    try {
      const query = `
        query getThemeFile($themeId: ID!, $filename: String!) {
          theme(id: $themeId) {
            files(first: 1, filenames: [$filename]) {
              nodes {
                filename
                body {
                  ... on OnlineStoreThemeFileBodyText {
                    content
                  }
                }
              }
            }
          }
        }
      `;

      const response = await this.admin.graphql(query, {
        variables: {
          themeId,
          filename: key,
        },
      });

      const data: GraphQLResponse = await response.json();

      if (data.errors) {
        console.error(`GraphQL errors getting ${key}:`, data.errors);
        return null;
      }

      const files = data.data?.theme?.files?.nodes || [];
      if (files.length === 0) {
        return null;
      }

      const file = files[0];
      return {
        key: file.filename,
        value: file.body?.content || '',
      };
    } catch (error) {
      console.error(`Error getting asset ${key}:`, error);
      return null;
    }
  }

  async updateAsset(themeId: string, key: string, value: string): Promise<boolean> {
    try {
      const mutation = `
        mutation themeFilesUpsert($files: [OnlineStoreThemeFilesUpsertFileInput!]!, $themeId: ID!) {
          themeFilesUpsert(files: $files, themeId: $themeId) {
            upsertedThemeFiles {
              filename
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const response = await this.admin.graphql(mutation, {
        variables: {
          themeId,
          files: [
            {
              filename: key,
              body: {
                type: "TEXT",
                value: value,
              },
            },
          ],
        },
      });

      const data: GraphQLResponse = await response.json();

      if (data.errors) {
        console.error(`GraphQL errors updating ${key}:`, data.errors);
        return false;
      }

      if (data.data?.themeFilesUpsert?.userErrors?.length > 0) {
        console.error(`User errors updating ${key}:`, data.data.themeFilesUpsert.userErrors);
        return false;
      }

      console.log(`Successfully updated ${key} in theme ${themeId}`);
      return true;
    } catch (error) {
      console.error(`Error updating asset ${key}:`, error);
      return false;
    }
  }

  async getRobotsFile(): Promise<string | null> {
    const themeId = await this.getPublishedThemeId();
    const asset = await this.getAsset(themeId, 'templates/robots.txt.liquid');
    return asset?.value || null;
  }

  async updateRobotsFile(content: string): Promise<boolean> {
    const themeId = await this.getPublishedThemeId();
    return await this.updateAsset(themeId, 'templates/robots.txt.liquid', content);
  }

  async getLlmsFile(): Promise<string | null> {
    const themeId = await this.getPublishedThemeId();
    const asset = await this.getAsset(themeId, 'templates/llms.txt.liquid');
    return asset?.value || null;
  }

  async updateLlmsFile(content: string): Promise<boolean> {
    const themeId = await this.getPublishedThemeId();
    // Check if content already has layout none directive
    const wrappedContent = content.startsWith('{% layout none %}')
      ? content
      : `{% layout none %}\n${content}`;
    return await this.updateAsset(themeId, 'templates/llms.txt.liquid', wrappedContent);
  }

  async createTemplateFile(filename: string, content: string): Promise<boolean> {
    const themeId = await this.getPublishedThemeId();
    const templatePath = filename.startsWith('templates/') ? filename : `templates/${filename}`;
    return await this.updateAsset(themeId, templatePath, content);
  }

  async createMultipleTemplateFiles(files: Array<{ filename: string; content: string }>): Promise<boolean> {
    try {
      const themeId = await this.getPublishedThemeId();

      const mutation = `
        mutation themeFilesUpsert($files: [OnlineStoreThemeFilesUpsertFileInput!]!, $themeId: ID!) {
          themeFilesUpsert(files: $files, themeId: $themeId) {
            upsertedThemeFiles {
              filename
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const templateFiles = files.map(file => ({
        filename: file.filename.startsWith('templates/') ? file.filename : `templates/${file.filename}`,
        body: {
          type: "TEXT",
          value: file.content,
        },
      }));

      const response = await this.admin.graphql(mutation, {
        variables: {
          themeId,
          files: templateFiles,
        },
      });

      const data: GraphQLResponse = await response.json();

      if (data.errors) {
        console.error('GraphQL errors creating multiple template files:', data.errors);
        return false;
      }

      if (data.data?.themeFilesUpsert?.userErrors?.length > 0) {
        console.error('User errors creating multiple template files:', data.data.themeFilesUpsert.userErrors);
        return false;
      }

      console.log(`Successfully created ${files.length} template files in theme ${themeId}`);
      return true;
    } catch (error) {
      console.error('Error creating multiple template files:', error);
      return false;
    }
  }
}