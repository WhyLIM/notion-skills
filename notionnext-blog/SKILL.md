---
name: notionnext-blog
description: Manage NotionNext blog posts via Notion API. Use when creating, reading, updating, or managing blog articles in a NotionNext-powered blog. Triggers on phrases like "写博客", "发文章", "新建笔记", "notionnext", "博客文章", "blog post", "write article", or any time the user wants to add content to their NotionNext blog database.
metadata: {"openclaw":{"emoji":"📝","requires":{"bins":["node"],"env":["NOTION_API_KEY"]},"primaryEnv":"NOTION_API_KEY","homepage":"https://docs.tangly1024.com"}}
user-invocable: true
---

# NotionNext Blog Manager

Manage blog posts in a NotionNext-compatible Notion database. NotionNext is a popular open-source framework that turns a Notion database into a blog/website. This skill handles the specific database structure it requires.

## Required Context

- Notion API version: **always use `2022-06-28`** (the `2025-09-03` version uses different endpoints like `/v1/data_sources/` that are incompatible).
- The NotionNext database has a specific schema with fixed `type` values.
- API Key: read from `NOTION_API_KEY` env var (or fallback `NOTION_TOKEN`, `NOTION_API_TOKEN`, `~/.config/notion/api_key`).

## Database Schema

A NotionNext blog database has these properties:

| Property | Type | Description |
|----------|------|-------------|
| **title** | title | Article title |
| **type** | select | **Must be one of: `Post`, `Page`, `Notice`, `Menu`, `SubMenu`, `Config`** |
| **category** | select | Article category (can create new values) |
| **tags** | multi_select | Article tags (can create new values) |
| **slug** | rich_text | URL path segment (lowercase English, hyphens) |
| **date** | date | Publication date |
| **status** | select | **Must be one of: `Published`, `Invisible`, `Draft`** |
| **summary** | rich_text | Article summary/excerpt |
| **icon** | rich_text | Icon identifier (optional) |
| **password** | rich_text | Access password (optional) |

## Quick Start

### 1. Configure the Database ID

Set the database ID in the environment variable `NOTIONNEXT_DATABASE_ID`, or provide it each time. To find your database ID:

1. Open your Notion database page
2. Click **Share** → **Publish** → **Share to web**
3. The 32-character hex string in the URL is your database ID

Add to `openclaw.json`:
```json
{
  "skills": {
    "entries": {
      "notionnext-blog": {
        "enabled": true,
        "env": {
          "NOTION_API_KEY": "your_notion_integration_key",
          "NOTIONNEXT_DATABASE_ID": "your_database_id"
        }
      }
    }
  }
}
```

### 2. Share the Database with Your Integration

In Notion, open the database → **···** → **Connections** → **Add connections** → select your integration.

### 3. Create a Blog Post

Use the bundled script:

```bash
node {baseDir}/scripts/notionnext-post.mjs create \
  --title "My New Article" \
  --category "技术分享" \
  --tags "Python,数据分析" \
  --slug "my-new-article" \
  --status Published \
  --summary "A brief summary of the article." \
  --date 2026-04-17 \
  --md "# My Article\n\nContent goes here."
```

Or read markdown from a file:
```bash
node {baseDir}/scripts/notionnext-post.mjs create \
  --title "My Article" \
  --md-file ./article.md \
  ...
```

### 4. Read / Export a Post

```bash
node {baseDir}/scripts/notionnext-post.mjs export --page "<page-id>"
```

### 5. Append Content

```bash
node {baseDir}/scripts/notionnext-post.mjs append --page "<page-id>" --md "Additional content."
```

### 6. Search Posts

```bash
node {baseDir}/scripts/notionnext-post.mjs list [--category "技术分享"] [--status Published] [--limit 20]
```

### 7. Update Properties

```bash
node {baseDir}/scripts/notionnext-post.mjs update --page "<page-id>" --set "status=Published" --set "category=AI"
```

## Operating Rules

- **`type` field**: For blog posts, always use `Post`. The other values (`Page`, `Notice`, `Menu`, `SubMenu`, `Config`) are for site structure, not blog content.
- **`status` field**: Use `Published` for live posts, `Draft` for work-in-progress, `Invisible` for hidden but published.
- **`slug`**: Must be URL-safe (lowercase English, numbers, hyphens). Auto-generate from title if not provided.
- **`category` and `tags`**: New values are created automatically. Pick the most relevant existing value first; only create new ones when nothing fits.
- **Markdown support**: The script converts standard Markdown (headings, lists, code blocks, bold, italic, blockquotes, dividers) to Notion blocks.
- **Rate limits**: Notion API allows ~3 requests/second. Back off on HTTP 429.

## Auto-fill Template

When creating a blog post, fill in these fields automatically if the user doesn't specify:

| Field | Auto-fill rule |
|-------|----------------|
| type | `Post` |
| status | `Published` |
| date | Today's date |
| slug | Auto-generate from title (transliterate Chinese to pinyin, lowercase, hyphens) |
| summary | Generate from first paragraph or ask user |
| category | Ask user or infer from content |
| tags | Infer from content |

## Troubleshooting

- **401 unauthorised**: Missing/invalid `NOTION_API_KEY`.
- **403 forbidden**: Integration not shared to the database. Add it via Connections.
- **404 not found**: Wrong database/page ID, or content not shared with integration.
- **400 invalid_request_url**: Using `2025-09-03` API version. **Must use `2022-06-28`.**
- **validation_error**: Invalid `type` value (must be one of the 6 fixed options), or property value doesn't match schema.
