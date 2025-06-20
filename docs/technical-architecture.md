# App Review Analysis - 技术架构文档

## 概述

App Review Analysis 是一个基于 AI 的应用评论分析平台，通过优化的并行处理架构实现高效的大规模评论数据分析。

## 架构概览

### 整体架构

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Supabase      │    │   Edge Functions│
│   (React/Vite)  │◄──►│   (Database)    │◄──►│   (Processing)  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌─────────────────┐
                       │   External APIs │
                       │  • DeepSeek AI  │
                       │  • App Store    │
                       │  • Google Play  │
                       │  • Reddit       │
                       └─────────────────┘
```

### 核心组件

#### 1. 前端应用 (React + TypeScript)
- **技术栈**: React 18, TypeScript, Vite, Tailwind CSS
- **状态管理**: Zustand
- **路由**: React Router v6
- **UI组件**: 自定义组件库
- **实时更新**: Supabase Realtime

#### 2. 数据库层 (Supabase)
- **主要表结构**:
  - `reports` - 分析报告主表
  - `scraped_reviews` - 抓取的评论数据
  - `analysis_tasks` - 分析任务队列
  - `processing_queue` - 处理队列管理
  - `system_metrics` - 系统性能指标
  - `alert_logs` - 告警日志

#### 3. 处理层 (Edge Functions)
- **数据抓取**: `scrape-app-store`, `scrape-google-play`, `scrape-reddit`
- **分析调度**: `start-analysis-v2`, `parallel-batch-scheduler`
- **批次处理**: `process-analysis-batch-v2`
- **监控管理**: `cron-analysis-monitor`, `alert-manager`
- **故障恢复**: `batch-retry-handler`, `cron-batch-recovery`

## 优化架构设计

### 并行处理系统

#### 工作流程
1. **任务分解**: 将大量评论按批次分组（200-500条/批次）
2. **并行调度**: `parallel-batch-scheduler` 同时处理4-6个批次
3. **智能负载均衡**: 根据系统负载动态调整并发数
4. **进度监控**: 实时跟踪每个批次的处理状态

#### 关键算法
```typescript
// 动态并发控制
async function getOptimalConcurrency(): Promise<number> {
  const systemLoad = await checkSystemLoad()
  const availableMemory = await checkMemoryUsage()
  
  if (systemLoad < 0.5 && availableMemory > 0.7) return 6
  if (systemLoad < 0.7 && availableMemory > 0.5) return 4
  return 2
}

// 自适应批次大小
function calculateBatchSize(totalTasks: number): number {
  if (totalTasks <= 500) return Math.min(200, totalTasks)
  if (totalTasks <= 2000) return 300
  if (totalTasks <= 5000) return 400
  return 500
}
```

### 队列管理系统

#### Processing Queue 表结构
```sql
CREATE TABLE processing_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  priority integer DEFAULT 5,
  status text CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  retry_count integer DEFAULT 0,
  max_retries integer DEFAULT 3,
  scheduled_at timestamptz DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  error_details jsonb,
  created_at timestamptz DEFAULT now()
);
```

#### 优先级调度算法
- **高优先级**: 重要客户报告 (priority = 1-3)
- **正常优先级**: 常规分析任务 (priority = 4-6)
- **低优先级**: 批量处理任务 (priority = 7-10)

### Cron Job 监控系统

#### 监控任务配置
```bash
# 每分钟执行分析进度检查
cron-analysis-monitor: "* * * * *"

# 每5分钟执行故障恢复
cron-batch-recovery: "*/5 * * * *"

# 每小时执行清理任务
cron-cleanup-tasks: "0 * * * *"
```

#### 自动恢复机制
1. **卡住任务检测**: 超过10分钟未更新状态
2. **失败任务重试**: 基于错误类型的智能重试策略
3. **资源清理**: 删除过期临时数据和日志

### 智能重试策略

#### 错误分类与重试配置
```typescript
const ERROR_TYPE_CONFIGS = {
  TIMEOUT: { maxRetries: 2, baseDelay: 5000 },
  API_LIMIT: { maxRetries: 5, baseDelay: 60000 },
  MEMORY_LIMIT: { maxRetries: 1, baseDelay: 10000 },
  NETWORK_ERROR: { maxRetries: 4, baseDelay: 1000 },
  DATA_ERROR: { maxRetries: 1, baseDelay: 5000 }
}
```

#### 指数退避算法
```typescript
function calculateDelay(retryCount: number, config: RetryConfig): number {
  let delay = config.baseDelay * Math.pow(config.exponentialFactor, retryCount)
  delay = Math.min(delay, config.maxDelay)
  
  // 添加10%随机抖动避免雷群效应
  if (config.jitterEnabled) {
    delay += delay * 0.1 * Math.random()
  }
  
  return Math.round(delay)
}
```

## 性能优化

### 数据库优化

#### 关键索引
```sql
-- 分析任务查询优化
CREATE INDEX CONCURRENTLY idx_analysis_tasks_status_priority 
ON analysis_tasks(status, batch_index) 
WHERE status IN ('pending', 'processing');

-- 队列查询优化
CREATE INDEX CONCURRENTLY idx_processing_queue_scheduled 
ON processing_queue(status, priority DESC, scheduled_at ASC) 
WHERE status = 'queued';

-- 监控查询优化
CREATE INDEX CONCURRENTLY idx_reports_processing_status 
ON reports(status, created_at DESC) 
WHERE status IN ('processing', 'pending');
```

#### 连接池配置
```typescript
const supabaseConfig = {
  poolSize: 10,              // 连接池大小
  connectionTimeout: 30000,  // 连接超时
  idleTimeout: 300000,       // 空闲超时
  acquireTimeout: 60000      // 获取连接超时
}
```

### AI API 优化

#### 批量处理策略
- **批次大小**: 200-500条评论/批次
- **并发限制**: 最大6个并发请求
- **请求优化**: 使用连接复用和压缩

#### DeepSeek API 配置
```typescript
const AI_CONFIG = {
  model: "deepseek-chat",
  max_tokens: 4000,
  temperature: 0.1,
  timeout: 60000,
  retries: 3
}
```

## 监控和告警

### 系统指标监控

#### 关键指标
- **处理性能**: 平均处理时间、吞吐量
- **系统健康**: CPU使用率、内存使用率
- **业务指标**: 成功率、失败率、队列长度
- **用户体验**: 响应时间、并发用户数

#### 告警规则
```typescript
const ALERT_RULES = [
  {
    name: "处理时间过长",
    condition: "average_processing_time > 300", // 5分钟
    severity: "medium",
    cooldown: 15 // 15分钟冷却期
  },
  {
    name: "错误率过高", 
    condition: "error_rate > 0.15", // 15%
    severity: "high",
    cooldown: 10
  },
  {
    name: "队列积压",
    condition: "queue_length > 20",
    severity: "medium", 
    cooldown: 20
  }
]
```

### 实时监控仪表板

#### 数据源
- `monitoring_dashboard` 视图：聚合系统统计
- `system_metrics` 表：详细性能指标
- `alert_logs` 表：告警历史记录

#### 监控面板
1. **系统概览**: 总报告数、处理中、已完成、队列长度
2. **性能指标**: 处理时间、成功率、失败率
3. **活跃告警**: 未解决的告警信息
4. **指标趋势**: 最近指标变化图表

## 部署指南

### 环境要求

#### 开发环境
- Node.js 18+
- npm 或 yarn
- Supabase CLI
- Git

#### 生产环境
- Supabase 项目
- Vercel 或类似静态部署平台
- 环境变量配置

### 部署步骤

#### 1. 数据库迁移
```bash
# 应用所有迁移
supabase db push

# 验证表结构
supabase db diff
```

#### 2. Edge Functions 部署
```bash
# 部署所有函数
supabase functions deploy --no-verify-jwt

# 设置 Cron 调度
# 在 Supabase Dashboard 中配置 Cron 触发器
```

#### 3. 前端部署
```bash
# 构建项目
npm run build

# 部署到 Vercel
vercel --prod
```

#### 4. 环境变量配置
```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
DEEPSEEK_API_KEY=your_deepseek_api_key
RAPIDAPI_KEY=your_rapidapi_key
```

### 监控配置

#### Supabase Dashboard 设置
1. 启用 Realtime 功能
2. 配置 RLS 策略
3. 设置 Cron 触发器
4. 配置告警通知

#### 性能监控
- 启用数据库日志记录
- 配置 Edge Function 监控
- 设置自定义指标追踪

## 故障排查

### 常见问题

#### 1. 处理超时
**症状**: 任务长时间处于 processing 状态
**原因**: AI API 响应慢或网络问题
**解决**: 检查 cron-analysis-monitor 日志，触发手动重试

#### 2. 队列积压
**症状**: 大量任务排队等待
**原因**: 并发限制或系统负载过高
**解决**: 调整并发参数或增加处理资源

#### 3. 数据库连接问题
**症状**: 连接超时错误
**原因**: 连接池耗尽或网络问题
**解决**: 检查连接池配置，重启相关服务

### 日志分析

#### 关键日志位置
- Edge Function 日志: Supabase Dashboard > Functions
- 数据库日志: Supabase Dashboard > Database > Logs
- 应用日志: 浏览器开发者工具

#### 日志级别
- **ERROR**: 严重错误需要立即处理
- **WARN**: 警告信息需要关注
- **INFO**: 常规操作日志
- **DEBUG**: 详细调试信息

### 性能调优

#### 批次大小调优
```typescript
// 监控内存使用情况调整批次大小
function optimizeBatchSize(currentSize: number, memoryUsage: number): number {
  if (memoryUsage > 0.8) return Math.max(100, currentSize * 0.8)
  if (memoryUsage < 0.5) return Math.min(600, currentSize * 1.2)
  return currentSize
}
```

#### 并发参数调优
```typescript
// 基于系统负载动态调整
function adjustConcurrency(currentConcurrency: number, systemLoad: number): number {
  if (systemLoad > 0.8) return Math.max(1, currentConcurrency - 1)
  if (systemLoad < 0.4) return Math.min(8, currentConcurrency + 1)
  return currentConcurrency
}
```

## 安全考虑

### 数据安全
- 所有敏感数据加密存储
- 实施行级安全策略 (RLS)
- 定期备份重要数据

### API 安全
- 使用 API 密钥认证
- 实施请求频率限制
- 验证输入数据格式

### 用户安全
- JWT token 认证
- 基于角色的访问控制
- 审计日志记录

## 版本控制

### Git 工作流
- `main` 分支：生产环境代码
- `develop` 分支：开发环境代码
- `feature/*` 分支：功能开发分支

### 版本发布
- 语义化版本控制 (SemVer)
- 自动化 CI/CD 流程
- 渐进式部署策略

---

*文档版本: v2.0*  
*最后更新: 2025年1月*  
*维护者: 开发团队* 