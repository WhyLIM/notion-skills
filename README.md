# notion-skills

常用 Notion 辅助工具集，基于 OpenClaw Skill 架构。

## 📚 已收录技能

| 技能 | 说明 | 适用场景 |
|------|------|----------|
| [notionnext-blog](./notionnext-blog/) | NotionNext 博客文章管理 | 创建/编辑/管理 NotionNext 博客文章 |

---

## 🔧 准备工作

使用本仓库技能前，需完成以下准备工作：

### 1. 搭建 NotionNext 博客

参考官方教程：https://tangly1024.com/article/vercel-deploy-notion-next

### 2. 创建 Notion Integration

1. 打开 https://www.notion.so/profile/integrations 页面
2. 创建新的集成（Integration），关联你的工作空间
3. 设置集成的【内容访问权限】为你的 NotionNext 数据库

> **小提示**：如果集成创建界面没有直接的权限设置入口，也可以在 Notion 数据库页面 → 设置（`...`） → 连接 → 对应集成 → 【管理集成的页面访问权限】中完成配置。

### 3. 获取配置信息

- **NOTION_API_KEY**：集成的 Token（Internal Integration Secret）
- **NOTIONNEXT_DATABASE_ID**：Notion 数据库的 32 位 ID（在数据库 URL 中获取）

---

## 📦 安装 Skill（OpenClaw 用户）

```bash
# 方式一：直接复制到 OpenClaw skills 目录
cp -r notionnext-blog ~/.openclaw/workspace/skills/

# 方式二：从 GitHub 拉取（未来版本支持）
```

## 🤖 仅使用脚本（非 OpenClaw 用户）

```bash
# 安装依赖
npm install node  # 仅需 Node.js，无需其他包

# 配置环境变量
export NOTION_API_KEY="your_integration_token"
export NOTIONNEXT_DATABASE_ID="your_database_id"

# 运行脚本
node notionnext-blog/scripts/notionnext-post.mjs --help
```

## 📝 License

MIT
