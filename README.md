# App Review Analysis Platform

一个智能化的应用评论分析平台，帮助开发者和产品团队深入了解用户反馈，优化产品体验。

## 🚀 功能特性

### 📊 多平台数据收集
- **App Store**: iOS应用评论抓取与分析
- **Google Play**: Android应用评论抓取与分析  
- **Reddit**: 社区讨论和用户反馈收集
- **自动化采集**: 定时任务和批量处理

### 🤖 智能分析引擎
- **主题提取**: AI驱动的用户反馈主题识别
- **情感分析**: 评论情感倾向自动分类
- **趋势分析**: 时序数据分析和趋势预测
- **平台对比**: 跨平台用户反馈对比分析

### 📈 可视化报告
- **交互式仪表板**: 实时数据可视化
- **PDF报告生成**: 专业分析报告导出
- **主题词云**: 直观的关键词可视化
- **时间序列图表**: 趋势变化可视化

### ⚡ 性能优化
- **并行处理**: [基于内存的优化设计][[memory:8095544503851038439]]，显著提升分析速度
- **队列系统**: 异步任务处理，提高系统响应性
- **超时控制**: 智能超时处理和重试机制
- **资源监控**: 实时系统状态监控

## 🏗️ 技术栈

### 前端
- **React 18**: 现代化用户界面框架
- **TypeScript**: 类型安全的JavaScript
- **Vite**: 快速的构建工具
- **Tailwind CSS**: 实用优先的CSS框架
- **Framer Motion**: 流畅的动画效果
- **Zustand**: 轻量级状态管理
- **React Query**: 数据获取和缓存
- **Lucide React**: 现代化图标库

### 后端 & 服务
- **Supabase**: 现代化后端即服务
  - PostgreSQL数据库
  - 实时API
  - 用户认证
  - Edge Functions
- **Deno**: 安全的JavaScript/TypeScript运行时
- **DeepSeek API**: AI文本分析服务

### 部署 & DevOps
- **GitHub Pages**: 静态网站托管
- **GitHub Actions**: CI/CD自动化
- **Supabase**: 后端服务托管

## 🛠️ 本地开发

### 环境要求
- Node.js 18+ 
- npm 或 yarn
- Git

### 安装步骤

1. **克隆仓库**
```bash
git clone https://github.com/your-username/app-review-analysis.git
cd app-review-analysis
```

2. **安装依赖**
```bash
npm install
```

3. **环境配置**
```bash
# 复制环境变量模板
cp .env.example .env.local

# 配置Supabase连接信息
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

4. **启动开发服务器**
```bash
npm run dev
```

5. **访问应用**
打开 http://localhost:5173

### 开发命令

```bash
# 开发模式
npm run dev

# 构建生产版本
npm run build

# 预览生产构建
npm run preview

# 代码检查
npm run lint
```

## 🚀 部署到GitHub Pages

### 自动部署（推荐）

项目已配置GitHub Actions自动部署：

1. **Fork或推送代码到GitHub仓库**

2. **启用GitHub Pages**
   - 进入仓库设置页面
   - 找到"Pages"选项
   - Source选择"GitHub Actions"

3. **更新配置**
   - 修改`package.json`中的`homepage`字段
   - 修改`vite.config.ts`中的`base`路径
   - 将`your-username`替换为实际的GitHub用户名

4. **推送代码**
```bash
git add .
git commit -m "Configure GitHub Pages deployment"
git push origin main
```

5. **自动部署**
   - GitHub Actions会自动构建并部署
   - 部署完成后访问: `https://your-username.github.io/app-review-analysis`

### 手动部署

```bash
# 安装gh-pages
npm install --save-dev gh-pages

# 构建并部署
npm run deploy
```

## 📁 项目结构

```
app-review-analysis/
├── src/
│   ├── components/          # React组件
│   │   ├── ui/             # 基础UI组件
│   │   └── ...             # 业务组件
│   ├── pages/              # 页面组件
│   ├── stores/             # 状态管理
│   ├── lib/                # 工具库
│   └── ...
├── supabase/
│   ├── functions/          # Edge Functions
│   ├── migrations/         # 数据库迁移
│   └── config.toml         # Supabase配置
├── .github/
│   └── workflows/          # GitHub Actions
└── ...
```

## 🔧 配置说明

### Supabase设置

1. **创建Supabase项目**
2. **运行数据库迁移**
3. **部署Edge Functions**
4. **配置环境变量**

### API密钥配置

```env
# Supabase
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key

# DeepSeek API (用于AI分析)
DEEPSEEK_API_KEY=your_deepseek_api_key
```

## 📊 使用指南

### 1. 开始分析

1. **登录/注册账户**
2. **选择分析类型**：
   - Reddit社区讨论分析
   - 特定应用分析（iOS/Android）
   - 综合分析

3. **配置分析参数**：
   - 搜索关键词
   - 时间范围
   - 平台选择

4. **启动分析任务**

### 2. 查看结果

1. **实时监控**: 在仪表板查看分析进度
2. **主题分析**: 查看AI提取的关键主题
3. **情感分析**: 了解用户情感倾向
4. **趋势分析**: 观察时间变化趋势

### 3. 导出报告

1. **在线查看**: 交互式数据可视化
2. **PDF导出**: 专业分析报告
3. **数据导出**: 原始数据下载

## 🤝 贡献指南

欢迎贡献代码！请遵循以下步骤：

1. Fork项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建Pull Request

## 📄 许可证

本项目采用MIT许可证 - 查看 [LICENSE](LICENSE) 文件了解详情

## 🙋‍♂️ 支持

如果您有任何问题或建议，请：

1. 查看[常见问题](docs/FAQ.md)
2. 创建[Issue](https://github.com/your-username/app-review-analysis/issues)
3. 发送邮件至：support@yourapp.com

## 🎯 路线图

- [ ] 支持更多评论平台
- [ ] 增强AI分析能力
- [ ] 实时监控功能
- [ ] 团队协作功能
- [ ] API接口开放

---

⭐ 如果这个项目对您有帮助，请给个Star支持！ 