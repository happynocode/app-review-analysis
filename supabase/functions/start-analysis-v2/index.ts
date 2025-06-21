import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2'

// 智能筛选算法（基于Reddit的质量评分系统）
function applyIntelligentFiltering(reviews: any[], appName: string, maxTotal: number = 2000): any[] {
  console.log(`🔧 开始智能筛选: ${reviews.length} 条原始评论 -> 目标 ${maxTotal} 条`);
  
  // 显示原始平台分布
  const originalPlatformCounts = {
    reddit: reviews.filter(r => r.platform === 'reddit').length,
    app_store: reviews.filter(r => r.platform === 'app_store').length,
    google_play: reviews.filter(r => r.platform === 'google_play').length
  };
  console.log(`📊 原始平台分布: Reddit ${originalPlatformCounts.reddit}, App Store ${originalPlatformCounts.app_store}, Google Play ${originalPlatformCounts.google_play}`);
  
  // 去重处理
  const seenHashes = new Set<string>();
  const uniqueReviews = reviews.filter(review => {
    const hash = simpleHash(review.review_text.substring(0, 200));
    if (seenHashes.has(hash)) {
      return false;
    }
    seenHashes.add(hash);
    return true;
  });
  
  // 显示去重后平台分布
  const deduplicatedPlatformCounts = {
    reddit: uniqueReviews.filter(r => r.platform === 'reddit').length,
    app_store: uniqueReviews.filter(r => r.platform === 'app_store').length,
    google_play: uniqueReviews.filter(r => r.platform === 'google_play').length
  };
  console.log(`📊 去重后平台分布: Reddit ${deduplicatedPlatformCounts.reddit}, App Store ${deduplicatedPlatformCounts.app_store}, Google Play ${deduplicatedPlatformCounts.google_play}`);
  
  // 时间筛选：只保留90天内的评论
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  
  const timeFilteredReviews = uniqueReviews.filter(review => {
    if (!review.review_date) return true; // 如果没有日期信息，保留
    const reviewDate = new Date(review.review_date);
    return reviewDate >= ninetyDaysAgo;
  });
  
  // 显示时间筛选后平台分布
  const timeFilteredPlatformCounts = {
    reddit: timeFilteredReviews.filter(r => r.platform === 'reddit').length,
    app_store: timeFilteredReviews.filter(r => r.platform === 'app_store').length,
    google_play: timeFilteredReviews.filter(r => r.platform === 'google_play').length
  };
  console.log(`📊 90天时间筛选后平台分布: Reddit ${timeFilteredPlatformCounts.reddit}, App Store ${timeFilteredPlatformCounts.app_store}, Google Play ${timeFilteredPlatformCounts.google_play}`);
  
  // 基础质量过滤（简化版：仅长度过滤）
  const appNameLower = appName.toLowerCase();
  const filteredReviews = timeFilteredReviews.filter(review => {
    // 只保留长度过滤：过短（<10字符）或过长（>5000字符）
    if (review.review_text.length < 10 || review.review_text.length > 5000) return false;
    
    return true;
  });
  
  // 显示质量过滤后平台分布
  const qualityFilteredPlatformCounts = {
    reddit: filteredReviews.filter(r => r.platform === 'reddit').length,
    app_store: filteredReviews.filter(r => r.platform === 'app_store').length,
    google_play: filteredReviews.filter(r => r.platform === 'google_play').length
  };
  console.log(`📊 质量过滤后平台分布: Reddit ${qualityFilteredPlatformCounts.reddit}, App Store ${qualityFilteredPlatformCounts.app_store}, Google Play ${qualityFilteredPlatformCounts.google_play}`);
  
  // 计算质量评分并排序
  const scoredReviews = filteredReviews.map(review => ({
    ...review,
    qualityScore: calculateQualityScore(review, appNameLower)
  }));
  
  // 按平台分组并选择最佳评论
  const platformGroups = {
    reddit: scoredReviews.filter(r => r.platform === 'reddit'),
    app_store: scoredReviews.filter(r => r.platform === 'app_store'),
    google_play: scoredReviews.filter(r => r.platform === 'google_play')
  };
  
  // 为每个平台分配配额（新配额：Reddit 400, App Store 2000, Google Play 2000）
  const redditQuota = Math.min(400, platformGroups.reddit.length);
  const appStoreQuota = Math.min(2000, platformGroups.app_store.length);
  const googlePlayQuota = Math.min(2000, platformGroups.google_play.length);
  
  console.log(`🎯 智能筛选配额: Reddit ${redditQuota}, App Store ${appStoreQuota}, Google Play ${googlePlayQuota}`);
  
  // 选择最高质量的评论
  const selectedReviews = [
    ...selectTopReviews(platformGroups.reddit, redditQuota),
    ...selectTopReviews(platformGroups.app_store, appStoreQuota),
    ...selectTopReviews(platformGroups.google_play, googlePlayQuota)
  ];
  
  // 显示最终筛选结果
  const finalPlatformCounts = {
    reddit: selectedReviews.filter(r => r.platform === 'reddit').length,
    app_store: selectedReviews.filter(r => r.platform === 'app_store').length,
    google_play: selectedReviews.filter(r => r.platform === 'google_play').length
  };
  console.log(`✅ 智能筛选完成: 最终选择 ${selectedReviews.length} 条高质量评论`);
  console.log(`📊 最终平台分布: Reddit ${finalPlatformCounts.reddit}, App Store ${finalPlatformCounts.app_store}, Google Play ${finalPlatformCounts.google_play}`);
  
  return selectedReviews;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

function calculateSimpleRelevanceScore(review: any, appNameLower: string): number {
  const text = review.review_text.toLowerCase();
  let score = 0;
  
  // 基础相关性
  if (text.includes(appNameLower)) score += 5;
  
  // 评价关键词
  const reviewTerms = ['good', 'bad', 'love', 'hate', 'recommend', 'experience', 'review', 'rating', '好', '差', '推荐', '体验', '评价'];
  for (const term of reviewTerms) {
    if (text.includes(term)) score += 1;
  }
  
  return score;
}

function calculateQualityScore(review: any, appNameLower: string): number {
  let score = 0;
  const text = review.review_text;
  
  // 长度评分
  score += Math.min(text.length / 50, 20);
  
  // 评分评分
  if (review.rating) {
    score += review.rating * 2;
  }
  
  // 时间评分（较新的评论加分）
  if (review.review_date) {
    const daysSince = (Date.now() - new Date(review.review_date).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince < 30) score += 10;
    else if (daysSince < 90) score += 5;
    else if (daysSince < 365) score += 2;
  }
  
  // 相关性评分
  score += calculateSimpleRelevanceScore(review, appNameLower);
  
  // 平台特殊评分
  if (review.platform === 'reddit') {
    const additionalData = review.additional_data || {};
    score += Math.min((additionalData.score || 0) * 0.1, 10);
    score += Math.min((additionalData.comment_count || 0) * 0.2, 5);
  }
  
  return score;
}

function selectTopReviews(reviews: any[], quota: number): any[] {
  return reviews
    .sort((a, b) => b.qualityScore - a.qualityScore)
    .slice(0, quota);
};

interface AnalysisConfig {
  maxConcurrentBatches: number;
  batchSize: number;
  priorityMode: 'balanced' | 'speed' | 'quality';
}

interface AnalysisResult {
  reportId: string;
  totalBatches: number;
  startedBatches: number;
  estimatedTime: number;
  status: 'started' | 'failed';
}

// 简化为只有themes分析
const ANALYSIS_TYPES = ['themes'];

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

    // 2. 获取scraping_session_id，然后获取抓取的评论数据
    const { data: scrapingSession, error: sessionError } = await supabase
      .from('scraping_sessions')
      .select('id')
      .eq('report_id', reportId)
      .single();

    if (sessionError || !scrapingSession) {
      return new Response(JSON.stringify({
        success: false,
        error: '没有找到对应的抓取会话'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 获取所有评论数据（分页查询避免1000条限制）
    let allReviews: any[] = [];
    let from = 0;
    const pageSize = 1000;
    
    while (true) {
      const { data: reviewsPage, error: reviewsError } = await supabase
        .from('scraped_reviews')
        .select('id, review_text, rating, platform, review_date, author_name, additional_data')
        .eq('scraping_session_id', scrapingSession.id)
        .range(from, from + pageSize - 1);

      if (reviewsError) {
        throw new Error(`获取评论数据失败: ${reviewsError.message}`);
      }

      if (!reviewsPage || reviewsPage.length === 0) {
        break;
      }

      allReviews.push(...reviewsPage);
      
      if (reviewsPage.length < pageSize) {
        break; // 最后一页
      }
      
      from += pageSize;
    }

    console.log(`📊 原始数据: 总共 ${allReviews.length} 条评论`);

    // 应用智能筛选算法（类似Reddit的质量筛选）
    const scrapedReviews = applyIntelligentFiltering(allReviews, report.app_name);

    if (!scrapedReviews?.length) {
      // 更新报告状态为failed，并提供详细的错误信息
      const { error: updateError } = await supabase
        .from('reports')
        .update({
          status: 'failed',
          failure_stage: 'scraping',
          error_message: '没有找到可分析的评论数据',
          failure_details: {
            totalScrapedReviews: allReviews.length,
            filteredReviews: scrapedReviews?.length || 0,
            suggestion: allReviews.length === 0 
              ? '抓取过程中没有找到相关评论，请尝试使用不同的应用名称或关键词' 
              : '抓取到的评论在质量筛选后被过滤掉了，请尝试使用更通用的应用名称'
          },
          updated_at: new Date().toISOString()
        })
        .eq('id', reportId);

      if (updateError) {
        console.error('更新报告状态失败:', updateError.message);
      }

      return new Response(JSON.stringify({
        success: false,
        error: '没有找到可分析的评论数据',
        details: {
          totalScrapedReviews: allReviews.length,
          filteredReviews: scrapedReviews?.length || 0,
          suggestion: allReviews.length === 0 
            ? '抓取过程中没有找到相关评论，请尝试使用不同的应用名称或关键词' 
            : '抓取到的评论在质量筛选后被过滤掉了，请尝试使用更通用的应用名称'
        }
      }), {
        status: 400,
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

    // 4. 创建分析任务（只有themes）
    const analysisTasks = await createAnalysisTasks(
      reportId, 
      scrapedReviews, 
      config,
      supabase,
      scrapingSession.id
    );

    console.log(`✅ 创建了 ${analysisTasks.length} 个分析任务`);

    // 5. 计算批次信息（基于平台智能批处理）
    const totalBatches = analysisTasks.length;
    
    // 统计平台分布
    const redditCount = scrapedReviews.filter(r => r.platform === 'reddit').length;
    const storeCount = scrapedReviews.filter(r => r.platform === 'app_store' || r.platform === 'google_play').length;
    const redditBatches = Math.ceil(redditCount / 50);
    const storeBatches = Math.ceil(storeCount / 400);

    console.log(`🔄 启动数据库触发器模式 - 总共 ${totalBatches} 个批次`);
    console.log(`📊 批次分布: Reddit ${redditBatches}批(${redditCount}条), 应用商店 ${storeBatches}批(${storeCount}条)`);

    // 6. 只启动第一批处理，后续由数据库触发器自动处理
    const firstBatchTasks = analysisTasks.slice(0, Math.min(4, analysisTasks.length));
    
    if (firstBatchTasks.length > 0) {
      const startSuccess = await startFirstBatch(reportId, firstBatchTasks, supabaseUrl, supabaseKey);
      
      if (!startSuccess) {
        // 如果第一批启动失败，将报告状态改为failed
        await supabase
          .from('reports')
          .update({
            status: 'failed',
            failure_stage: 'analysis',
            error_message: '启动第一批处理失败',
            failure_details: {
              reason: '无法启动分析任务',
              suggestion: '请检查系统状态或重试'
            },
            updated_at: new Date().toISOString()
          })
          .eq('id', reportId);
          
        throw new Error('启动第一批处理失败');
      }
    } else {
      // 如果没有任务可处理，直接将报告状态改为completed
      await supabase
        .from('reports')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', reportId);
        
      return new Response(JSON.stringify({
        success: true,
        message: '没有需要处理的分析任务',
        result: {
          reportId,
          totalBatches: 0,
          startedBatches: 0,
          estimatedTime: 0,
          status: 'completed',
          reviewCount: scrapedReviews.length
        }
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

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

async function startFirstBatch(
  reportId: string, 
  tasks: any[], 
  supabaseUrl: string, 
  supabaseKey: string
): Promise<boolean> {
  try {
    console.log(`🚀 启动第一批处理，包含 ${tasks.length} 个任务`);

    const response = await fetch(`${supabaseUrl}/functions/v1/process-analysis-batch-v2`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        reportId,
        tasks,
        enableChainProcessing: false // 不再使用链式处理
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`第一批启动失败:`, errorText);
      return false;
    }

    console.log(`✅ 第一批启动成功`);
    return true;
  } catch (error) {
    console.error(`第一批启动异常:`, error);
    return false;
  }
}

async function createAnalysisTasks(
  reportId: string, 
  reviews: any[], 
  config: any,
  supabase: any,
  scrapingSessionId: string
): Promise<any[]> {
  // 按平台分组评论
  const platformGroups = {
    reddit: reviews.filter(r => r.platform === 'reddit'),
    app_store: reviews.filter(r => r.platform === 'app_store'),
    google_play: reviews.filter(r => r.platform === 'google_play')
  };

  console.log(`📊 评论平台分布: Reddit ${platformGroups.reddit.length}, App Store ${platformGroups.app_store.length}, Google Play ${platformGroups.google_play.length}`);

  const tasks = [];
  let globalBatchIndex = 0;

  // 处理Reddit评论 - 50个一批
  if (platformGroups.reddit.length > 0) {
    const redditBatchSize = 50;
    console.log(`🔴 处理Reddit评论: ${platformGroups.reddit.length}条，每批${redditBatchSize}个`);
    
    for (let i = 0; i < platformGroups.reddit.length; i += redditBatchSize) {
      const batchReviews = platformGroups.reddit.slice(i, i + redditBatchSize);
      
      const task = {
        report_id: reportId,
        scraping_session_id: scrapingSessionId,
        batch_index: globalBatchIndex++,
        analysis_type: 'themes',
        reviews_data: batchReviews,
        status: 'pending',
        priority: 7,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      
      tasks.push(task);
    }
  }

  // 处理App Store和Google Play评论 - 400个一批
  const storeReviews = [...platformGroups.app_store, ...platformGroups.google_play];
  if (storeReviews.length > 0) {
    const storeBatchSize = 400;
    console.log(`🍎 处理应用商店评论: ${storeReviews.length}条，每批${storeBatchSize}个`);
    
    for (let i = 0; i < storeReviews.length; i += storeBatchSize) {
      const batchReviews = storeReviews.slice(i, i + storeBatchSize);
      
      const task = {
        report_id: reportId,
        scraping_session_id: scrapingSessionId,
        batch_index: globalBatchIndex++,
        analysis_type: 'themes',
        reviews_data: batchReviews,
        status: 'pending',
        priority: 7,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      
      tasks.push(task);
    }
  }
  
  // 批量插入分析任务，并返回生成的id
  const { data: insertedTasks, error: insertError } = await supabase
    .from('analysis_tasks')
    .insert(tasks)
    .select('*');
  
  if (insertError) {
    throw new Error(`创建分析任务失败: ${insertError.message}`);
  }
  
  return insertedTasks || [];
}