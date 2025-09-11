/**
 * @jest-environment node
 */

import { authenticate } from "../app/shopify.server";
import { loader as improveAeoLoader, action as improveAeoAction } from "../app/routes/api.improve-aeo";
import { loader as statusLoader } from "../app/routes/api.files.status";
import { action as restoreAction } from "../app/routes/api.restore-backup";

// Mock the authenticate function
jest.mock("../app/shopify.server", () => ({
  authenticate: {
    admin: jest.fn(),
  },
}));

const mockAuthenticate = authenticate as jest.Mocked<typeof authenticate>;

// Mock services
const mockAeoService = {
  improveAEO: jest.fn(),
  getStatus: jest.fn(),
  restoreBackup: jest.fn(),
};

const mockThemeService = {};
const mockShopService = {};
const mockGeminiService = {};
const mockBackupService = {};

jest.mock("../app/services/aeo.service", () => ({
  AEOService: jest.fn(() => mockAeoService),
}));

jest.mock("../app/services/shopify-theme.service", () => ({
  ShopifyThemeService: jest.fn(() => mockThemeService),
}));

jest.mock("../app/services/shopify-shop.service", () => ({
  ShopifyShopService: jest.fn(() => mockShopService),
}));

jest.mock("../app/services/gemini.service", () => ({
  GeminiService: jest.fn(() => mockGeminiService),
}));

jest.mock("../app/services/backup.service", () => ({
  BackupService: jest.fn(() => mockBackupService),
}));

jest.mock("../app/db.server", () => ({}));

describe("API Routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthenticate.admin.mockResolvedValue({
      admin: { session: { shop: "test-shop.myshopify.com" } },
    });
  });

  describe("POST /api/improve-aeo", () => {
    it("should successfully improve AEO", async () => {
      const mockResult = {
        success: true,
        operationId: "op-123",
        robotsUpdated: true,
        llmsUpdated: true,
        backups: [{ id: "backup-1" }, { id: "backup-2" }],
      };

      mockAeoService.improveAEO.mockResolvedValue(mockResult);

      const request = new Request("http://localhost/api/improve-aeo", {
        method: "POST",
      });

      const response = await improveAeoAction({ request, params: {}, context: {} });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual(mockResult);
      expect(mockAuthenticate.admin).toHaveBeenCalledWith(request);
      expect(mockAeoService.improveAEO).toHaveBeenCalled();
    });

    it("should handle AEO improvement failure", async () => {
      const mockResult = {
        success: false,
        error: "Gemini API error",
      };

      mockAeoService.improveAEO.mockResolvedValue(mockResult);

      const request = new Request("http://localhost/api/improve-aeo", {
        method: "POST",
      });

      const response = await improveAeoAction({ request, params: {}, context: {} });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual(mockResult);
    });

    it("should handle service errors", async () => {
      mockAeoService.improveAEO.mockRejectedValue(new Error("Service error"));

      const request = new Request("http://localhost/api/improve-aeo", {
        method: "POST",
      });

      const response = await improveAeoAction({ request, params: {}, context: {} });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toContain("Service error");
    });

    it("should only allow POST method", async () => {
      const request = new Request("http://localhost/api/improve-aeo", {
        method: "GET",
      });

      const response = await improveAeoLoader({ request, params: {}, context: {} });
      
      expect(response.status).toBe(405);
    });
  });

  describe("GET /api/files/status", () => {
    it("should return current status", async () => {
      const mockStatus = {
        shopDomain: "test-shop.myshopify.com",
        homepageUrl: "https://test-shop.com",
        currentRobots: "robots content",
        currentLlms: "llms content",
        lastOperation: {
          id: "op-123",
          status: "success",
          createdAt: new Date(),
        },
        backups: [{ id: "backup-1" }],
      };

      mockAeoService.getStatus.mockResolvedValue(mockStatus);

      const request = new Request("http://localhost/api/files/status");

      const response = await statusLoader({ request, params: {}, context: {} });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual(mockStatus);
      expect(mockAuthenticate.admin).toHaveBeenCalledWith(request);
      expect(mockAeoService.getStatus).toHaveBeenCalled();
    });

    it("should handle status retrieval errors", async () => {
      mockAeoService.getStatus.mockRejectedValue(new Error("Status error"));

      const request = new Request("http://localhost/api/files/status");

      const response = await statusLoader({ request, params: {}, context: {} });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toContain("Status error");
    });
  });

  describe("POST /api/restore-backup", () => {
    it("should successfully restore backup", async () => {
      const mockResult = {
        success: true,
        robotsRestored: true,
        llmsRestored: true,
      };

      mockAeoService.restoreBackup.mockResolvedValue(mockResult);

      const request = new Request("http://localhost/api/restore-backup", {
        method: "POST",
      });

      const response = await restoreAction({ request, params: {}, context: {} });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual(mockResult);
      expect(mockAuthenticate.admin).toHaveBeenCalledWith(request);
      expect(mockAeoService.restoreBackup).toHaveBeenCalled();
    });

    it("should handle restore failure", async () => {
      const mockResult = {
        success: false,
        error: "No backups found",
      };

      mockAeoService.restoreBackup.mockResolvedValue(mockResult);

      const request = new Request("http://localhost/api/restore-backup", {
        method: "POST",
      });

      const response = await restoreAction({ request, params: {}, context: {} });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual(mockResult);
    });

    it("should handle service errors", async () => {
      mockAeoService.restoreBackup.mockRejectedValue(new Error("Restore service error"));

      const request = new Request("http://localhost/api/restore-backup", {
        method: "POST",
      });

      const response = await restoreAction({ request, params: {}, context: {} });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toContain("Restore service error");
    });
  });
});