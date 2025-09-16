import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { ShopifyThemeService } from "../services/shopify-theme.service";

// Support both GET and POST for easier testing
export const loader = async ({ request }: ActionFunctionArgs) => {
  return handleMakeNewFileTest(request);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }
  return handleMakeNewFileTest(request);
};

const handleMakeNewFileTest = async (request: Request) => {

  try {
    const { admin } = await authenticate.admin(request);

    // Initialize theme service
    const themeService = new ShopifyThemeService(admin);

    console.log("=== TESTING MAKE NEW FILE FUNCTIONALITY ===");
    console.log("Testing makeNewFile functionality...");
    console.log("Checking existing files...");

    const startTime = Date.now();

    // Check if files already exist
    const existingRobots = await themeService.getRobotsFile();
    const existingLlms = await themeService.getLlmsFile();

    console.log("Existing robots.txt.liquid:", existingRobots ? "Found" : "Not found");
    console.log("Existing llms.txt.liquid:", existingLlms ? "Found" : "Not found");

    const filesToCreate = [];
    if (!existingRobots) {
      filesToCreate.push({
        filename: 'robots.txt.liquid',
        content: 'User-agent: *\nAllow: /'
      });
    }
    if (!existingLlms) {
      filesToCreate.push({
        filename: 'llms.txt.liquid',
        content: '{% layout none %}\nModel: llm\nSitemap: {{ shop.url }}/sitemap.xml'
      });
    }

    let message = '';
    let filesCreated = [];

    if (filesToCreate.length > 0) {
      console.log(`Creating ${filesToCreate.length} files:`, filesToCreate.map(f => f.filename));

      const result = await themeService.createMultipleTemplateFiles(filesToCreate);

      if (result) {
        const fileNames = filesToCreate.map(f => f.filename);
        filesCreated = fileNames;
        message = `AEO files processed: ${fileNames.join(', ')} created`;
        console.log("Files created successfully:", fileNames);
      } else {
        console.log("Failed to create files");
        return json({
          success: false,
          error: 'Failed to create files',
          existingFiles: {
            robotsExists: !!existingRobots,
            llmsExists: !!existingLlms
          }
        }, { status: 400 });
      }
    } else {
      message = 'Both robots.txt.liquid and llms.txt.liquid already exist';
      console.log(message);
    }

    // Verify files were created by checking again
    console.log("Verifying files after creation...");
    const verifyRobots = await themeService.getRobotsFile();
    const verifyLlms = await themeService.getLlmsFile();

    const endTime = Date.now();
    const duration = endTime - startTime;

    console.log(`=== TEST COMPLETED IN ${duration}ms ===`);
    console.log("Final status:");
    console.log("- robots.txt.liquid:", verifyRobots ? "EXISTS" : "NOT FOUND");
    console.log("- llms.txt.liquid:", verifyLlms ? "EXISTS" : "NOT FOUND");

    return json({
      success: true,
      message,
      filesCreated,
      duration: `${duration}ms`,
      verification: {
        robotsExists: !!verifyRobots,
        llmsExists: !!verifyLlms,
        robotsContent: verifyRobots ? verifyRobots.substring(0, 100) + "..." : null,
        llmsContent: verifyLlms ? verifyLlms.substring(0, 100) + "..." : null
      },
      beforeCreation: {
        robotsExisted: !!existingRobots,
        llmsExisted: !!existingLlms
      }
    }, { status: 200 });

  } catch (error) {
    console.error("API error in test-make-new-file:", error);

    // If authentication fails, return a more specific error
    if (error && typeof error === 'object' && 'status' in error && error.status === 410) {
      return json(
        {
          success: false,
          error: "Authentication failed. Please refresh the page and try again.",
        },
        { status: 401 }
      );
    }

    return json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      },
      { status: 500 }
    );
  }
};