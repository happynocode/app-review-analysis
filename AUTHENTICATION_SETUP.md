# Authentication Setup Guide

## 概述

本项目已移除所有Edge Functions的`--no-verify-jwt`标志，现在所有函数调用都需要适当的认证。

## 认证架构

### 前端 → Edge Functions
- **使用**: `anon key` (VITE_SUPABASE_ANON_KEY)
- **Header**: `Authorization: Bearer <anon_key>`

### Edge Functions 之间调用
- **使用**: `service role key` (SUPABASE_SERVICE_ROLE_KEY)
- **Header**: `Authorization: Bearer <service_role_key>`

## GitHub Actions 环境变量设置

### 1. GitHub Pages 部署需要的变量

在 GitHub repository 的 **Settings > Secrets and variables > Actions** 中设置：

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### 2. Supabase Functions 部署需要的变量

已经存在的变量（无需修改）：
```
SUPABASE_ACCESS_TOKEN=<your-supabase-access-token>
SUPABASE_PROJECT_ID=<your-project-id>
```

## 修改的文件

### 1. 部署配置
- `.github/workflows/deploy-supabase-functions.yml` - 移除所有`--no-verify-jwt`标志

### 2. Edge Functions 调用
- `supabase/functions/start-scraping/index.ts` - 添加service role认证
- `supabase/functions/generate-report/index.ts` - 添加service role认证
- `supabase/functions/cron-batch-processor/index.ts` - 添加service role认证
- `supabase/functions/cron-scraping-monitor/index.ts` - 添加service role认证
- `supabase/functions/fix-orphaned-reports/index.ts` - 添加service role认证

### 3. 前端调用
- `src/pages/LandingPage.tsx` - 已经正确使用anon key认证

## 安全考虑

1. **anon key** 可以安全地暴露在前端代码中
2. **service role key** 只在服务器端Edge Functions中使用
3. 所有API调用现在都需要有效的JWT验证
4. 移除`--no-verify-jwt`提高了整体安全性

## 验证部署

部署后，确认：
1. 前端可以正常调用Edge Functions
2. Edge Functions之间可以正常互相调用
3. 没有401 Unauthorized错误
4. 所有功能正常工作

## 故障排除

如果遇到401错误：
1. 检查环境变量是否正确设置
2. 确认使用了正确的key类型（前端用anon，后端用service role）
3. 检查Authorization header格式是否正确
