import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { AEOService } from "../services/aeo.service";
import { ShopifyThemeService } from "../services/shopify-theme.service";
import { ShopifyShopService } from "../services/shopify-shop.service";
import { GeminiService } from "../services/gemini.service";
import { BackupService } from "../services/backup.service";
import prisma from "../db.server";

// Only allow POST requests
export const loader = async ({ request }: LoaderFunctionArgs) => {
  return json({ error: "Method not allowed" }, { status: 405 });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const { admin } = await authenticate.admin(request);

    // Initialize services
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

    // Execute AEO improvement
    console.log("Starting AEO improvement...");
    const result = await aeoService.improveAEO();

    if (result.success) {
      console.log("AEO improvement completed successfully");
      return json(result, { status: 200 });
    } else {
      console.log("AEO improvement failed:", result.error);
      return json(result, { status: 400 });
    }
  } catch (error) {
    console.error("API error in improve-aeo:", error);
    
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