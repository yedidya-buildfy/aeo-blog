# AEO One-Click (Gemini Direct) - Development TODO List

## ✅ Phase 1: Shopify App Setup & Core Services [COMPLETED]

### 1.1 Shopify App Configuration (Required for Theme API Access)
- [x] Configure `shopify.app.toml` with required scopes: `read_themes`, `write_themes`
- [x] Set up OAuth flow to get proper access tokens with theme permissions
- [x] Test app installation on development store to verify theme access
- [x] Verify app can read existing theme assets via Shopify Admin API

### 1.2 Test-Driven Backend Development
- [x] **Plan Test**: Write test for Shopify Themes API service (read/write theme assets)
- [x] **Build Code**: Create `ShopifyThemeService` with theme asset operations
- [x] **Run Test**: Verify theme service can read/write `robots.txt.liquid` and `llms.txt.liquid`

- [x] **Plan Test**: Write test for Shopify Shop API service (get shop domain/info)
- [x] **Build Code**: Create `ShopifyShopService` to fetch shop information
- [x] **Run Test**: Verify service returns shop domain and homepage URL

- [x] **Plan Test**: Write test for Gemini API integration with AEO prompt
- [x] **Build Code**: Create `GeminiService` with the specified AEO prompt template
- [x] **Run Test**: Verify Gemini returns plain text llms.txt content

- [x] **Plan Test**: Write test for backup system (save/restore theme files)
- [x] **Build Code**: Create backup system using Prisma database
- [x] **Run Test**: Verify backups are created and can be restored

**Phase 1 Results**: ✅ All 32 tests passing across 4 service modules. Core infrastructure complete.

## ✅ Phase 2: Core AEO Logic (Test-First) [COMPLETED]

- [x] **Plan Test**: Write integration test for complete AEO improvement flow
- [x] **Build Code**: Create main `AEOService` that orchestrates:
  - Backup existing files
  - Write universal `robots.txt.liquid` template
  - Call Gemini with shop homepage URL
  - Create `llms.txt.liquid` with Gemini response
- [x] **Run Test**: Verify end-to-end AEO improvement works

- [x] **Plan Test**: Write test for error handling and rollback scenarios
- [x] **Build Code**: Add error handling and rollback functionality
- [x] **Run Test**: Verify rollback works when operations fail

- [x] **Plan Test**: Write test for restore functionality
- [x] **Build Code**: Create restore functionality for backups
- [x] **Run Test**: Verify backups can be restored successfully

**Phase 2 Results**: ✅ All 38 tests passing across 5 service modules. Core AEO orchestration complete with full error handling and rollback capabilities.

## ✅ Phase 3: Frontend & API (Test-First) [COMPLETED]

- [x] **Plan Test**: Write test for API endpoints (improve-aeo, files/status, restore-backup)
- [x] **Build Code**: Create API routes:
  - `POST /api/improve-aeo` - main action
  - `GET /api/files/status` - dashboard data  
  - `POST /api/restore-backup` - restore functionality
- [x] **Run Test**: Verify all API endpoints work correctly

- [x] **Plan Test**: Write frontend component tests for dashboard UI
- [x] **Build Code**: Create dashboard with:
  - "Improve AEO" button
  - robots.txt and llms.txt display panels (read-only)
  - Status display with timestamp and restore button
  - Loading states and error messaging
- [x] **Run Test**: Verify UI components work and integrate with API

**Phase 3 Results**: ✅ Clean Polaris dashboard with full API integration, loading states, error handling, and real-time status updates.

## ✅ Phase 4: End-to-End Testing & Production [COMPLETED]

- [x] **Plan Test**: Create end-to-end test with real Shopify development store
- [x] **Run Test**: Test complete flow with real Shopify store and Gemini API  
- [x] **Verify**: Authentication fixed, GraphQL integration working, preview mode functional
- [x] **Fix Authentication**: Converted from REST to GraphQL API for compatibility
- [x] **Plan Test**: Write tests for edge cases and error scenarios
- [x] **Run Test**: Verified error handling for API failures, network issues, invalid responses
- [x] **Deploy**: Ready for production with working authentication and preview functionality

**Phase 4 Results**: ✅ Production-ready app with GraphQL authentication, preview mode for AEO files, and comprehensive error handling. Repository committed to GitHub.

---

## Technical Implementation Notes

### Key Components to Build:
1. **ShopifyThemeService** - Handle theme asset operations
2. **ShopifyShopService** - Get shop information  
3. **GeminiService** - AI content generation
4. **BackupService** - File backup and restore
5. **AEOService** - Main orchestration logic
6. **Dashboard Components** - React/UI components

### Database Schema (Prisma):
```prisma
model Shop {
  id          String   @id @default(cuid())
  shopDomain  String   @unique
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  backups     Backup[]
  operations  AEOOperation[]
}

model Backup {
  id            String   @id @default(cuid())
  shopId        String
  fileName      String   // 'robots.txt' or 'llms.txt'
  content       String?  // backup content
  createdAt     DateTime @default(now())
  
  shop          Shop     @relation(fields: [shopId], references: [id])
}

model AEOOperation {
  id          String   @id @default(cuid())
  shopId      String
  status      String   // 'success', 'failed', 'in_progress'
  error       String?
  createdAt   DateTime @default(now())
  
  shop        Shop     @relation(fields: [shopId], references: [id])
}
```

### Environment Variables Required:
- `GEMINI_API_KEY` - For AI content generation
- `SHOPIFY_API_KEY` - App credentials
- `SHOPIFY_API_SECRET` - App credentials
- `DATABASE_URL` - PostgreSQL connection

---

## Success Criteria:
✅ One-click AEO improvement functionality  
✅ Universal robots.txt with AI bot permissions  
✅ Gemini-generated llms.txt content  
✅ Dashboard showing both file contents  
✅ Backup and restore functionality  
✅ Error handling and rollback capability  
✅ Production-ready deployment