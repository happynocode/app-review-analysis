# 🚀 ReviewInsight - AI-Powered App Review Analysis Platform

> 智能应用评论分析平台，基于人工智能技术深度分析多平台用户评论，快速生成洞察报告

## 📋 项目概述

**ReviewInsight** 是一个基于AI技术的应用评论分析平台，能够从多个平台（App Store、Google Play、Reddit）自动爬取和分析用户评论，利用先进的自然语言处理技术提取关键洞察，生成专业的分析报告。

### 🎯 核心功能

- **🔍 多平台抓取**: 支持App Store、Google Play、Reddit等主流平台
- **🧠 AI智能分析**: 使用OpenAI GPT模型深度分析评论内容
- **📊 实时监控**: 完整的任务监控和进度跟踪
- **⚡ 高性能处理**: 并行批处理架构，高效处理大量数据
- **📈 可视化报告**: 美观的报告展示和PDF导出功能
- **🔐 用户认证**: 基于Supabase的安全认证系统

### 🏗️ 技术架构

**前端 (React + TypeScript)**
- ⚛️ React 18 + TypeScript
- 🎨 Tailwind CSS + Framer Motion
- 🔄 React Query + Zustand
- 📱 响应式设计

**后端 (Supabase)**
- 🗄️ PostgreSQL 数据库
- ⚡ Supabase Edge Functions (Deno)
- 🔐 Row Level Security (RLS)
- ⏰ Cron作业系统

**AI & 数据处理**
- 🤖 OpenAI GPT-4 API
- 📝 智能主题提取
- 🎯 情感分析
- 📊 数据可视化

## 🚀 快速开始

### 环境要求

- Node.js 18+
- npm 或 yarn
- Supabase CLI
- PostgreSQL 15+

### 1. 克隆项目

```bash
git clone https://github.com/happynocode/app-review-analysis.git
cd app-review-analysis
```

### 2. 安装前端依赖

```bash
npm install
```

### 3. 环境配置

创建 `.env.local` 文件：

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 4. 启动开发服务器

```bash
npm run dev
```

## 🛠️ 部署指南

### 前端部署 (GitHub Pages)

```bash
npm run build
npm run deploy
```

### 后端部署 (Supabase)

```bash
# 初始化Supabase项目
supabase init

# 启动本地开发环境
supabase start

# 部署数据库迁移
supabase db push

# 部署Edge Functions
supabase functions deploy
```

## 📁 项目结构

```
app-review-analysis/
├── 📂 src/                    # 前端源代码
│   ├── 📂 components/         # React组件
│   │   ├── 📂 ui/            # 基础UI组件
│   │   ├── AuthModal.tsx     # 认证模态框
│   │   ├── AppSelectionModal.tsx  # 应用选择
│   │   └── ...
│   ├── 📂 pages/             # 页面组件
│   │   ├── LandingPage.tsx   # 首页
│   │   ├── DashboardPage.tsx # 仪表板
│   │   ├── ReportPage.tsx    # 报告页面
│   │   └── DemoPage.tsx      # 演示页面
│   ├── 📂 stores/            # 状态管理
│   │   ├── authStore.ts      # 认证状态
│   │   └── reportStore.ts    # 报告状态
│   ├── 📂 lib/               # 工具库
│   │   ├── supabase.ts       # Supabase客户端
│   │   └── database.ts       # 数据库操作
│   └── App.tsx               # 主应用组件
├── 📂 supabase/              # 后端代码
│   ├── 📂 functions/         # Edge Functions
│   │   ├── start-analysis-v2/        # 启动分析
│   │   ├── process-analysis-batch-v2/ # 批处理分析
│   │   ├── generate-report/          # 生成报告
│   │   ├── complete-report-analysis/ # 完成分析
│   │   ├── scrape-app-store/         # App Store爬虫
│   │   ├── scrape-google-play/       # Google Play爬虫
│   │   ├── scrape-reddit/            # Reddit爬虫
│   │   ├── search-apps/              # 应用搜索
│   │   ├── start-scraping/           # 启动爬虫
│   │   ├── update-scraper-status/    # 更新状态
│   │   ├── cron-batch-processor/     # 定时批处理
│   │   ├── cron-scraping-monitor/    # 爬虫监控
│   │   └── delete-all-data/          # 删除数据
│   ├── 📂 migrations/        # 数据库迁移
│   │   ├── 20250100_complete_schema.sql
│   │   ├── 20250100_simplified_architecture.sql
│   │   └── cron_jobs.sql
│   └── config.toml          # Supabase配置
├── 📂 public/               # 静态资源
├── package.json            # 项目配置
├── tailwind.config.js      # Tailwind配置
├── vite.config.ts          # Vite配置
└── README.md              # 项目文档
```

## 🔧 核心功能模块

### 1. 评论抓取系统

- **App Store**: 使用Apple Search API抓取iOS应用评论
- **Google Play**: 通过网页抓取获取Android应用评论
- **Reddit**: 搜索相关讨论和用户反馈

### 2. AI分析引擎

- **智能筛选**: 去重、时间过滤、质量评分
- **主题提取**: 自动识别用户关注的关键问题
- **情感分析**: 分析用户情感倾向
- **洞察生成**: 提供可行的改进建议

### 3. 报告生成

- **实时进度**: 分析进度实时更新
- **可视化展示**: 图表和数据可视化
- **PDF导出**: 专业报告格式导出
- **分享功能**: 支持报告链接分享

## 📊 数据库架构

### 核心表结构

- **users**: 用户信息
- **reports**: 分析报告
- **themes**: 分析主题
- **quotes**: 用户评论引用
- **suggestions**: 改进建议
- **scraping_sessions**: 抓取会话
- **scraped_reviews**: 原始评论数据
- **analysis_tasks**: 分析任务
- **processing_queue**: 处理队列

## 🔐 安全特性

- **Row Level Security (RLS)**: 数据访问控制
- **JWT认证**: 安全的用户认证
- **API限流**: 防止滥用
- **数据加密**: 敏感数据加密存储

## 📈 性能优化

- **并行处理**: 多批次并行分析
- **智能缓存**: 减少重复计算
- **数据库优化**: 索引和查询优化
- **CDN加速**: 静态资源CDN分发

## 🤝 贡献指南

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📝 更新日志

### v2.0.0 (2025-01)
- ✨ 重构AI分析引擎
- ⚡ 性能优化，提升60-70%处理速度
- 🔧 完善监控系统
- 📱 优化用户界面

### v1.0.0 (2024-12)
- 🎉 首次发布
- 🔍 多平台评论抓取
- 🧠 AI智能分析
- 📊 报告生成系统

## 📞 支持与联系


- 🐛 问题反馈: [GitHub Issues](https://github.com/happynocode/app-review-analysis/issues)


## 📄 许可证

本项目采用 [MIT License](LICENSE) 许可证。

---

<div align="center">
  <p>Made with ❤️ by ReviewInsight Team</p>
  <p>⭐ 如果这个项目对你有帮助，请给我们一个星星！</p>
</div> 