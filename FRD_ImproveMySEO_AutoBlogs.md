# FRD — Feature: “Improve My SEO (Automated Blogs)”

## Goal  
Enable merchants to improve their SEO with **zero effort**. With one click, the app sets up an **automated blog publishing plan**: Gemini chooses the keywords, plans topics, writes the posts, adds images, and publishes them on a schedule (e.g., 1 per week).

---

## User Flow
1. Merchant opens the app and goes to **“Improve My SEO”** page.  
2. Merchant clicks **“Start SEO Automation”**.  
3. Behind the scenes:  
   - **Blog Orchestrator (Gemini)**  
     - Scans store (products, collections, categories, sitemap).  
     - Chooses keywords automatically.  
     - Generates a blog plan (e.g., 12 weeks = 12 posts).  
   - **Blog Creator (Gemini)**  
     - For each planned topic: generates full SEO-optimized blog content.  
     - Includes: meta title, meta description, H1/H2/H3 headings, body, internal links, FAQ, JSON-LD schema, and **images with alt text** (images can be suggested or pulled from content context).  
   - **Scheduler**  
     - Stores plan and publishes 1 blog per week.  
4. Dashboard shows:  
   - **Plan overview** (“Next 12 blogs scheduled”).  
   - **Upcoming blog titles + publish dates**.  
   - **Preview thumbnails for images**.  
   - **Pause/Resume** toggle.  

---

## Key Features
- **One-click setup**.  
- **Automatic keyword research** (Gemini).  
- **SEO-optimized blog plan**.  
- **Blog writing with images** (Gemini suggests relevant images + alt text).  
- **Weekly auto-publish** via Shopify Blog API.  
- **Dashboard view** with schedule, upcoming posts, and images.  
- **Pause/Resume** automation.  

---

## Technical Design
- **Orchestrator (Gemini)**  
  - Input: store homepage + sitemap.  
  - Output: JSON blog plan with `{title, keyword, publish_date}`.  
- **Blog Creator (Gemini)**  
  - Input: keyword/topic.  
  - Output: blog JSON:  
    ```json
    {
      "meta_title": "",
      "meta_description": "",
      "slug": "",
      "title_h1": "",
      "body_html": "",
      "faq": [],
      "internal_links": [],
      "schema_jsonld": {},
      "images": [
        {"prompt": "image idea", "alt": "alt text"}
      ]
    }
    ```
- **Scheduler**  
  - Saves plan in DB.  
  - Publishes 1 article/week.  
- **Shopify Admin API**  
  - Create blog article with title, body, SEO fields, schema, and attach images.  

---

## Acceptance Criteria
- One click generates blog plan (≥4 weeks).  
- Each blog contains: meta, H1/H2s, body, internal links, FAQ, schema, and at least 1 image with alt text.  
- Blogs auto-publish weekly.  
- Dashboard shows schedule, posts, and preview images.  
- Merchant can pause/resume automation.  
