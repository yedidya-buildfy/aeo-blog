# TODO: Simple Blog Billing + SEO Blog Feature

## 1. Blog Creation Page (Main Feature)
- [ ] Create `/seo-blogs` page - "Improve My SEO" 
- [ ] Add "Find Keywords" button (step 1)
- [ ] Implement Keyword Finder (Gemini API)
  - [ ] Scan store products/collections
  - [ ] Generate keyword list with search volume/difficulty
  - [ ] Show keywords to user for approval
- [ ] Add "Initialize SEO" button (step 2) 
  - [ ] Create 10 blogs immediately from approved keywords
  - [ ] Publish all 10 blogs at once
- [ ] Add "Start Automation" button (step 3)
- [ ] Implement Blog Orchestrator (Gemini API)
  - [ ] Generate ongoing 12-week blog plan from remaining keywords
- [ ] Add scheduler for weekly auto-publish
- [ ] Show dashboard with published blogs + upcoming posts

## 2. Database (Prisma) 
- [ ] Add `Subscription` model: `shopId`, `blogsUsed`, `monthlyLimit`, `planPrice`, `trialEndsAt`
- [ ] Add `BlogPlan` model: `shopId`, `posts[]`, `status`, `schedule`
- [ ] Run `npx prisma migrate dev`

## 3. Billing (Shopify Best Practices)
- [ ] Use GraphQL Admin API for charges
- [ ] Offer 2-3 simple plans (Starter/Pro)
- [ ] Add 7-day free trial
- [ ] Create `/api/billing` with RecurringApplicationCharge
- [ ] Support merchant's local currency

## 4. Frontend
- [ ] Create `/billing` page: usage, plans, upgrade
- [ ] Add billing + SEO blogs links to navigation
- [ ] Block blog creation if over limit

## 5. Integration
- [ ] Check billing limits before blog generation
- [ ] Track usage on each blog publish
- [ ] Handle Shopify billing webhooks