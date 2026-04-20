# notionnext-blog

NotionNext 博客文章管理脚本，支持通过命令行创建、读取、追加、更新博客文章。

## 功能特性

- ✅ **创建文章**：支持 Markdown 内容直接写入或从文件读取
- ✅ **读取/导出**：查看文章内容和属性
- ✅ **追加内容**：向已有文章追加 Markdown 内容（自动分批）
- ✅ **列表搜索**：按分类/标签/状态筛选文章
- ✅ **更新属性**：修改文章的分类、标签、状态等属性
- ✅ **中文 slug**：自动将中文标题转为拼音 slug
- ✅ **Markdown 转换**：支持标题、加粗、斜体、代码块、列表、引用等格式

## 前置条件

1. **已搭建 NotionNext 博客**（参考：[NotionNext 部署教程](https://tangly1024.com/article/vercel-deploy-notion-next)）
2. **已创建 Notion Integration**（参考：[创建集成](https://www.notion.so/profile/integrations)）
3. **已配置集成的页面访问权限**（关联到你的 NotionNext 数据库）
4. **Node.js** 已安装

## 快速开始

### 1. 配置环境变量

```bash
export NOTION_API_KEY="secret_xxxxxxxxxxxxxxxxxxxx"
export NOTIONNEXT_DATABASE_ID="610563a7-77f3-8201-9c83-814d07de5c0b"
```

### 2. 查看帮助

```bash
node scripts/notionnext-post.mjs
```

### 3. 创建文章

```bash
# 直接传入 Markdown 内容
node scripts/notionnext-post.mjs create \
  --title "我的测试文章" \
  --category "技术分享" \
  --tags "Python,AI" \
  --md "# 标题\n\n正文内容"

# 或从文件读取
node scripts/notionnext-post.mjs create \
  --title "我的测试文章" \
  --category "技术分享" \
  --md-file ./article.md
```

### 4. 列出文章

```bash
# 列出最近 20 篇
node scripts/notionnext-post.mjs list

# 按分类筛选
node scripts/notionnext-post.mjs list --category "技术分享"

# 列出所有文章
node scripts/notionnext-post.mjs list --all
```

### 5. 读取文章内容

```bash
node scripts/notionnext-post.mjs export --page <page-id>
```

### 6. 追加内容

```bash
node scripts/notionnext-post.mjs append \
  --page <page-id> \
  --md "## 新增章节\n\n这是追加的内容"
```

### 7. 更新文章属性

```bash
node scripts/notionnext-post.mjs update \
  --page <page-id> \
  --set status=Published \
  --set category=AI
```

## Notion 数据库必填字段

| 字段 | 类型 | 说明 |
|------|------|------|
| title | title | 文章标题 |
| type | select | 固定填 `Post` |
| slug | rich_text | URL 路径（英文+短横线） |
| status | select | `Published` / `Draft` / `Invisible` |
| date | date | 发布日期 |
| category | select | 文章分类 |
| tags | multi_select | 文章标签 |
| summary | rich_text | 文章摘要 |

## 注意事项

- 使用 **Notion API 版本 `2022-06-28`**，请勿使用 `2025-09-03` 等新版本（接口不兼容）
- `type` 字段固定为 `Post`，不可填其他值
- 新建 `category` 和 `tags` 时会自动创建，无需手动预定义

## 文件结构

```
notionnext-blog/
├── README.md
├── SKILL.md          # OpenClaw Skill 定义（供 AI 助手使用）
└── scripts/
    └── notionnext-post.mjs   # 核心脚本
```
