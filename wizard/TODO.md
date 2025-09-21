# AEO Wizard Implementation TODO

3-click wizard implementation based on `/wizard/wizard-plan.md`

## Phase 1: Basic 3-Click Wizard ✅
- [x] Create `WizardOverlay.tsx` component
- [x] Add wizard detection to `app.tsx`
- [x] Build 3-step flow: AEO → Plan → Blog Generation
- [x] Add metafield for completion tracking

## Phase 2: Pro Blog Features ⏳
- [ ] Add 10-blog generation for Pro plan
- [ ] Show "X/10 initialize blogs done" progress messages
- [ ] Auto-setup weekly publishing after blog generation
- [ ] Handle plan upgrades in wizard

## Phase 3: SEO Page Integration ⏳
- [ ] Add "Start Blog Generation" button to SEO page
- [ ] Auto-run keyword discovery on click
- [ ] Auto-generate first blog + Pro bulk blogs
- [ ] Complete wizard and mark as done

---

**3-Click User Flow:**
1. **Click 1:** "Improve My AEO" → Auto-runs AEO setup
2. **Click 2:** Select plan (Free/Starter/Pro)
3. **Click 3:** "Start Blog Generation" → Auto-completes everything

**Pro Plan Special Handling:**
- Shows "1/10 initialize blogs done, 2/10 initialize blogs done..."
- Runs 10 blogs in background while showing progress
- Sets up 5 blogs/week automation after completion

**Files to Create:**
- `app/components/WizardOverlay.tsx`
- `app/components/WizardStep1-3.tsx`

**Files to Modify:**
- `app/routes/app.tsx` - wizard detection
- `app/routes/app.seo-blogs.tsx` - blog generation button
- `app/services/billing.service.ts` - Pro 10-blog feature

**Timeline:** 1 week