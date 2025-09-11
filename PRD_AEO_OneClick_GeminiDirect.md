# PRD — Shopify App: “AEO One-Click (Gemini Direct)”

## 1) Goal  
Make it **as simple as possible** for a merchant to improve AEO in one click.  

- Button: **“Improve AEO”**  
- Behind the scenes:  
  1. Install universal `robots.txt.liquid`.  
  2. Send the shop’s homepage URL to **Gemini**, let Gemini crawl the site.  
  3. Gemini returns a ready `llms.txt` body.  
  4. App writes it to `templates/llms.txt.liquid`.  
- Show both files in dashboard (read-only).  

---

## 2) User Flow
1. Merchant opens app → sees **Improve AEO** button.  
2. Click → app:  
   - Backups existing `robots.txt.liquid` and `llms.txt.liquid`.  
   - Writes universal `robots.txt.liquid`.  
   - Calls Gemini with prompt + shop homepage URL.  
   - Receives plain text llms body.  
   - Writes it into `templates/llms.txt.liquid` with `{% layout none %}`.  
3. Dashboard updates with:  
   - Robots.txt content.  
   - Llms.txt content.  
   - Timestamp of last update.  
4. If fail → show error + restore option.  

---

## 3) Technical Design

### Shopify APIs
- **Themes API**: write theme assets (`robots.txt.liquid`, `llms.txt.liquid`).  
- **Shop API**: read shop info (name, domain) → supply to Gemini.  

Scopes:  
- `read_themes`, `write_themes`  

### Gemini Prompt
```
You are an AI Engine Optimization (AEO) expert.
Crawl the given Shopify store URL and generate a production-ready llms.txt file.

Rules:
- Plain text only (no markdown, no HTML).
- Structure:
  Brand summary (1–3 lines)
  Core pages (Homepage, FAQ, Contact)
  Top products (5–10) with names + URLs
  Collections (up to 5) with URLs
  Policies (shipping, refund, privacy, terms)
  Short Q&A (2–4 common questions with answers)
  Keywords (5–15 terms)

URL: {{store_homepage_url}}
Return only the llms body.
```

### Robots.txt (universal)
```liquid
{%- comment -%} Universal AEO-friendly robots.txt {%- endcomment -%}
User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: anthropic-ai
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: PerplexityBot
Allow: /

{%- for group in robots.default_groups -%}
{{- group.user_agent -}}
{%- for rule in group.rules -%}
{{- rule -}}
{%- endfor -%}
{%- if group.sitemap != blank -%}
{{ group.sitemap }}
{%- endif -%}
{%- endfor -%}
```

### Llms.txt (template)
```liquid
{% layout none %}
{{ llms_body }}
```
> `{{ llms_body }}` = replaced with Gemini’s plain text output before upload.  

---

## 4) Dashboard UI
- **Main button:** Improve AEO  
- **Panels:**  
  - Robots.txt (monospace read-only)  
  - Llms.txt (monospace read-only)  
- **Status:** Last updated at [timestamp]  
- **Restore button:** Restore last backup  

---

## 5) Acceptance Criteria
- Clicking Improve AEO produces:  
  - `/robots.txt` served with universal AI-allow + Shopify defaults.  
  - `/llms.txt` served with Gemini’s generated content.  
- Dashboard shows both file contents.  
- Backups exist and can be restored.  
