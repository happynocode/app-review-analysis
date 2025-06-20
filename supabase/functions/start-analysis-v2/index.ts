import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

interface AnalysisConfig {
  enableParallelProcessing: boolean;
  maxConcurrentBatches: number;
  batchSize: number;
  priorityMode: 'balanced' | 'speed' | 'quality';
}

interface AnalysisResult {
  reportId: string;
  totalBatches: number;
  scheduledBatches: number;
  estimatedTime: number;
  status: 'started' | 'queued' | 'failed';
}

const ANALYSIS_TYPES = ['sentiment', 'themes', 'keywords', 'issues'];

Deno.serve(async (req: Request) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { reportId, config = {} } = await req.json();

    if (!reportId) {
      return new Response(JSON.stringify({
        success: false,
        error: 'reportId is required'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log(`🚀 开始分析v2 - 报告ID: ${reportId}`);

    // 1. 验证报告状态
    const { data: report, error: reportError } = await supabase
      .from('reports')
      .select('*')
      .eq('id', reportId)
      .single();

    if (reportError || !report) {
      return new Response(JSON.stringify({
        success: false,
        error: '报告不存在或无法访问'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (report.status !== 'scraping_completed') {
      return new Response(JSON.stringify({
        success: false,
        error: '报告状态不正确，必须完成抓取后才能开始分析'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 2. 获取抓取的评论数据
    const { data: scrapedReviews, error: reviewsError } = await supabase
      .from('scraped_reviews')
      .select('id, review_text, rating, platform')
      .eq('report_id', reportId);

    if (reviewsError || !scrapedReviews?.length) {
      return new Response(JSON.stringify({
        success: false,
        error: '没有找到抓取的评论数据'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log(`📊 找到 ${scrapedReviews.length} 条评论，准备分析`);

    // 3. 更新报告状态为分析中
    const { error: updateError } = await supabase
      .from('reports')
      .update({
        status: 'analyzing',
        analysis_started_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', reportId);

    if (updateError) {
      throw new Error(`更新报告状态失败: ${updateError.message}`);
    }

    // 4. 创建分析任务
    const analysisTasks = await createAnalysisTasks(
      reportId, 
      scrapedReviews, 
      config,
      supabase
    );

    console.log(`✅ 创建了 ${analysisTasks.length} 个分析任务`);

    // 5. 选择处理模式
    const enableParallel = config.enableParallelProcessing !== false && scrapedReviews.length > 100;
    
    if (enableParallel) {
      // 并行处理模式
      console.log('🔄 启动并行处理模式');
      
      const parallelResult = await fetch(`${supabaseUrl}/functions/v1/parallel-batch-scheduler`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          reportId,
          config: {
            maxConcurrentBatches: config.maxConcurrentBatches || 4,
            adaptiveBatchSize: true,
            loadBalancing: true
          }
        })
      });

      if (parallelResult.ok) {
        const parallelData = await parallelResult.json();
        console.log('✅ 并行调度启动成功');
        
        return new Response(JSON.stringify({
          success: true,
          message: '分析任务已启动（并行模式）',
          result: {
            reportId,
            totalBatches: parallelData.result.scheduledBatches,
            scheduledBatches: parallelData.result.immediatelyStarted,
            estimatedTime: parallelData.result.estimatedTotalTime,
            status: 'started',
            mode: 'parallel',
            reviewCount: scrapedReviews.length
          }
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } else {
        console.warn('⚠️ 并行调度失败，回退到串行模式');
        // 继续使用串行模式
      }
    }

    // 6. 串行处理模式（回退方案）
    console.log('🔄 启动串行处理模式');
    
    let processedBatches = 0;
    const batchSize = config.batchSize || 20;
    const totalBatches = Math.ceil(analysisTasks.length / batchSize);

    for (let i = 0; i < analysisTasks.length; i += batchSize) {
      const batchTasks = analysisTasks.slice(i, i + batchSize);
      const batchIndex = Math.floor(i / batchSize);
      
      try {
        // 触发批次处理
        const batchResult = await fetch(`${supabaseUrl}/functions/v1/process-analysis-batch`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            reportId,
            batchIndex,
            tasks: batchTasks,
            mode: 'serial'
          })
        });

        if (batchResult.ok) {
          processedBatches++;
          console.log(`✅ 批次 ${batchIndex + 1}/${totalBatches} 已启动`);
        } else {
          console.error(`❌ 批次 ${batchIndex + 1} 启动失败`);
        }
      } catch (error) {
        console.error(`批次 ${batchIndex + 1} 处理异常:`, error);
      }
    }

    const result: AnalysisResult = {
      reportId,
      totalBatches,
      scheduledBatches: processedBatches,
      estimatedTime: totalBatches * 30, // 估算30秒每批次
      status: processedBatches > 0 ? 'started' : 'failed'
    };

    console.log(`📊 分析启动完成: ${processedBatches}/${totalBatches} 批次成功`);

    return new Response(JSON.stringify({
      success: true,
      message: '分析任务已启动（串行模式）',
      result: {
        ...result,
        mode: 'serial',
        reviewCount: scrapedReviews.length
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('❌ 分析启动失败:', error);
    
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

async function createAnalysisTasks(
  reportId: string, 
  reviews: any[], 
  config: any,
  supabase: any
): Promise<any[]> {
  const tasks = [];
  const batchSize = config.batchSize || 20;
  
  // 按批次创建任务
  for (let i = 0; i < reviews.length; i += batchSize) {
    const batchReviews = reviews.slice(i, i + batchSize);
    const batchIndex = Math.floor(i / batchSize);
    
    // 为每种分析类型创建任务
    for (const analysisType of ANALYSIS_TYPES) {
      const task = {
        id: `task_${reportId}_${batchIndex}_${analysisType}_${Date.now()}`,
        report_id: reportId,
        batch_index: batchIndex,
        analysis_type: analysisType,
        review_ids: batchReviews.map(r => r.id),
        status: 'pending',
        priority: getAnalysisTypePriority(analysisType, config.priorityMode),
        created_at: new Date().toISOString()
      };
      
      tasks.push(task);
    }
  }

  // 批量插入任务到数据库
  const { error: insertError } = await supabase
    .from('analysis_tasks')
    .insert(tasks);

  if (insertError) {
    throw new Error(`创建分析任务失败: ${insertError.message}`);
  }

  return tasks;
}

function getAnalysisTypePriority(analysisType: string, priorityMode: string = 'balanced'): number {
  const priorities = {
    balanced: { sentiment: 8, themes: 7, keywords: 6, issues: 9 },
    speed: { sentiment: 9, themes: 6, keywords: 7, issues: 8 },
    quality: { sentiment: 7, themes: 9, keywords: 6, issues: 8 }
  };
  
  return priorities[priorityMode as keyof typeof priorities]?.[analysisType as keyof typeof priorities.balanced] || 5;
} 