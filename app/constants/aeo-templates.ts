export const UNIVERSAL_ROBOTS_TXT = `{%- comment -%} Universal AEO-friendly robots.txt {%- endcomment -%}
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
{%- endfor -%}`;