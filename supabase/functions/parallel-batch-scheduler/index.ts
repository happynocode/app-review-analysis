import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

interface ParallelBatchConfig {
  maxConcurrentBatches: number;
  adaptiveBatchSize: boolean;
  loadBalancing: boolean;
}

interface AnalysisBatch {
  batchId: string;
  reviewIds: string[];
  complexity: number;
  estimatedDuration: number;
  priority?: number;
}

const DEFAULT_CONFIG: ParallelBatchConfig = {
  maxConcurrentBatches: 4,
  adaptiveBatchSize: true,
  loadBalancing: true
};

Deno.serve(async (req: Request) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { reportId, config = DEFAULT_CONFIG } = await req.json();

    if (!reportId) {
      return new Response(JSON.stringify({
        success: false,
        error: 'reportId is required'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log(`🚀 开始并行批次调度 - 报告ID: ${reportId}`);

    // 1. 获取系统当前负载
    const systemLoad = await getSystemLoad(supabase);
    const optimalConcurrency = await calculateOptimalConcurrency(systemLoad, config);

    // 2. 获取待处理的分析任务
    const { data: analysisTasks, error: tasksError } = await supabase
      .from('analysis_tasks')
      .select('*')
      .eq('report_id', reportId)
      .eq('status', 'pending')
      .order('batch_index');

    if (tasksError || !analysisTasks?.length) {
      return new Response(JSON.stringify({
        success: false,
        error: 'No pending analysis tasks found'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 3. 智能批次分组
    const batchGroups = await createIntelligentBatchGroups(analysisTasks, config);

    // 4. 将任务添加到处理队列
    const queueEntries = batchGroups.map((batch, index) => ({
      report_id: reportId,
      batch_id: batch.batchId,
      priority: batch.priority || 5,
      status: 'queued' as const,
      retry_count: 0,
      max_retries: 3,
      scheduled_at: new Date(Date.now() + index * 1000).toISOString()
    }));

    const { error: queueError } = await supabase
      .from('processing_queue')
      .insert(queueEntries);

    if (queueError) {
      throw new Error(`队列插入失败: ${queueError.message}`);
    }

    // 5. 启动并行处理（前几个批次）
    const immediateProcessing = batchGroups.slice(0, optimalConcurrency);
    
    const processingPromises = immediateProcessing.map(async (batch) => {
      try {
        const response = await fetch(`${supabaseUrl}/functions/v1/process-analysis-batch`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            batch_id: batch.batchId,
            review_ids: batch.reviewIds
          })
        });
        return response.ok;
      } catch (error) {
        console.error(`批次处理启动失败:`, error);
        return false;
      }
    });

    const results = await Promise.allSettled(processingPromises);
    const successCount = results.filter(r => r.status === 'fulfilled' && r.value).length;

    console.log(`✅ 并行调度完成: ${successCount}/${immediateProcessing.length} 批次成功启动`);

    return new Response(JSON.stringify({
      success: true,
      message: '并行批次调度完成',
      result: {
        scheduledBatches: batchGroups.length,
        immediatelyStarted: successCount,
        concurrencyLevel: optimalConcurrency,
        estimatedTotalTime: Math.max(...batchGroups.map(b => b.estimatedDuration))
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('❌ 并行调度失败:', error);
    
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

async function getSystemLoad(supabase: any) {
  try {
    const { count: processingTasks } = await supabase
      .from('processing_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'processing');

    return {
      cpuUsage: Math.min((processingTasks || 0) * 20, 100),
      memoryUsage: Math.min((processingTasks || 0) * 15, 90),
      activeConnections: processingTasks || 0
    };
  } catch (error) {
    return { cpuUsage: 30, memoryUsage: 40, activeConnections: 0 };
  }
}

async function calculateOptimalConcurrency(systemLoad: any, config: ParallelBatchConfig) {
  const { cpuUsage, memoryUsage } = systemLoad;
  
  if (cpuUsage < 30 && memoryUsage < 50) {
    return Math.min(config.maxConcurrentBatches, 6);
  } else if (cpuUsage < 50 && memoryUsage < 70) {
    return Math.min(config.maxConcurrentBatches, 4);
  } else {
    return 2;
  }
}

async function createIntelligentBatchGroups(tasks: any[], config: ParallelBatchConfig): Promise<AnalysisBatch[]> {
  const batches: AnalysisBatch[] = [];
  
  const batchSize = config.adaptiveBatchSize ? 
    Math.ceil(tasks.length / config.maxConcurrentBatches) : 
    20;

  for (let i = 0; i < tasks.length; i += batchSize) {
    const batchTasks = tasks.slice(i, i + batchSize);
    const complexity = batchTasks.length;
    
    batches.push({
      batchId: `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      reviewIds: batchTasks.map(t => t.id),
      complexity,
      estimatedDuration: Math.ceil(complexity * 2), // 2秒每任务
      priority: Math.max(10 - Math.floor(i / batchSize), 1)
    });
  }

  return batches;
} 