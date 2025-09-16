# Production Readiness Issues

## 1. Hard-coded Preview Domain
- **Location:** `app/services/aeo.service.ts:41`
- **Problem:** `previewAEO()` always targets `https://drive-buddy.com/`, so every merchant previews third-party content instead of their own store.
- **Suggested Fix:** Fetch the active shop domain via `ShopifyShopService` (or loader-provided status) and feed the correct storefront URL into Gemini. Remove the hard-coded string.

## 2. Theme Asset Operations Are No-ops
- **Location:** `app/services/shopify-theme.service.ts:36-85`
- **Problem:** `getAsset` and `updateAsset` merely log messages and return `null/true`; no GraphQL call occurs. The app reports success even when nothing is read or written, so backups/restores silently fail in production.
- **Suggested Fix:** Implement the actual Admin API asset queries/mutations (REST or GraphQL) with error handling, and propagate failures back to callers.

## 3. Unnecessary Gemini Dependency In Shared Setup
- **Locations:**
  - `app/routes/app._index.tsx:34-84`
  - `app/routes/api.preview-aeo.tsx:19-30`
  - `app/routes/api.improve-aeo.tsx:19-30`
  - `app/routes/api.restore-backup.tsx:19-30`
- **Problem:** Each route action/loader instantiates `new GeminiService()`, whose constructor throws when `GEMINI_API_KEY` is unset. Even loaders/actions that never call Gemini (e.g., status fetch, restore) still crash if the key is missing.
- **Suggested Fix:** Lazy-instantiate Gemini only when needed or wrap creation in a factory that tolerates missing keys for non-Gemini flows. Centralize service bootstrapping so this logic lives in one place.

## 4. Loader Swallows Errors and Hides Failures
- **Location:** `app/routes/app._index.tsx:49-63`
- **Problem:** The loader catches **all** errors, logs them, but still returns `{ error: null }` plus a fake "Authenticating..." status. The UI then shows a spinner forever, masking real issues like missing env vars or Prisma failures.
- **Suggested Fix:** Return an error message (or throw a response) when the loader fails so the UI can surface a critical banner. Avoid defaulting to `error: null` in the failure path.

## 5. Duplicated Service Bootstrapping
- **Locations:** Same as Issue 3
- **Problem:** Loader/actions repeat identical service-construction code. Any change (e.g., removing Gemini from restore) must be made in every copy, increasing the odds of drift.
- **Suggested Fix:** Extract a shared helper (e.g., `createAeoServices(admin)` or `getServiceBundle`) that builds the services once. Update callers to use it, reducing duplication and centralizing configuration.

## 6. Bypassing GeminiService in SEO Blogs Route
- **Location:** `app/routes/app.seo-blogs.tsx:92-147`
- **Problem:** The action calls Gemini via a bespoke `fetch`, duplicating request logic and headers instead of reusing `GeminiService.generateLlmsContent`. Changes to the client (endpoint, auth) won’t propagate here.
- **Suggested Fix:** Inject and reuse `GeminiService`, or move the shared HTTP logic into the service so routes don’t hand-roll requests. That keeps authentication, retries, and error handling consistent.
