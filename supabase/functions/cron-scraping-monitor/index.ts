import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

interface ScrapingMonitorResult {
  checked_reports: number;
  completed_reports: number;
  failed_reports: number;
  triggered_analyses: number;
  execution_time: number;
  errors: string[];
}

interface ScrapingStats {
  total_reviews: number;
  app_store_reviews: number;
  google_play_reviews: number;
  reddit_posts: number;
  platforms_with_data: number;
}

const MIN_REVIEWS_THRESHOLD = 50; // 最小评论数量阈值
const MAX_WAIT_TIME_MINUTES = 15; // 最大等待时间（分钟）

Deno.serve(async (req: Request) => {
  const startTime = Date.now();
  
  try {
    // 初始化Supabase客户端
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('🔄 抓取监控开始执行...');

    const result: ScrapingMonitorResult = {
      checked_reports: 0,
      completed_reports: 0,
      failed_reports: 0,
      triggered_analyses: 0,
      execution_time: 0,
      errors: []
    };

    // 1. 查找正在抓取的报告
    const { data: scrapingReports, error: reportsError } = await supabase
      .from('reports')
      .select(`
        id, 
        app_name, 
        created_at, 
        updated_at,
        scraping_sessions (
          id, 
          status, 
          started_at, 
          total_reviews_found,
          app_store_reviews,
          google_play_reviews,
          reddit_posts,
          enabled_platforms,
          app_store_scraper_status,
          google_play_scraper_status,
          reddit_scraper_status
        )
      `)
      .eq('status', 'scraping')
      .order('created_at', { ascending: true });

    if (reportsError) {
      throw new Error(`查询抓取报告失败: ${reportsError.message}`);
    }

    if (!scrapingReports || scrapingReports.length === 0) {
      console.log('✅ 没有正在抓取的报告');
      result.execution_time = Date.now() - startTime;
      return new Response(JSON.stringify({
        success: true,
        message: '没有正在抓取的报告',
        result
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log(`🔍 发现 ${scrapingReports.length} 个正在抓取的报告`);
    result.checked_reports = scrapingReports.length;

    // 2. 检查每个报告的抓取状态
    for (const report of scrapingReports) {
      try {
        console.log(`📊 检查报告 ${report.id} (${report.app_name})`);

        const scrapingSession = report.scraping_sessions?.[0];
        if (!scrapingSession) {
          console.log(`⚠️ 报告 ${report.id} 没有抓取会话，跳过`);
          continue;
        }

        // 获取实际的抓取数据 - 使用 scraping_session_id 而不是 report_id
        const { data: scrapedReviews, error: reviewsError } = await supabase
          .from('scraped_reviews')
          .select('id, platform, review_text, rating')
          .eq('scraping_session_id', scrapingSession.id);

        if (reviewsError) {
          result.errors.push(`获取报告 ${report.id} 的评论数据失败: ${reviewsError.message}`);
          continue;
        }

        // 🆕 使用新的状态检查逻辑
        const isComplete = checkScrapingComplete(scrapingSession);
        
        // 保持向后兼容的统计数据计算
        const stats = calculateScrapingStats(scrapedReviews || []);

        // 🆕 显示新的状态信息
        console.log(`📈 报告 ${report.id} 抓取状态:`, {
          enabled_platforms: scrapingSession.enabled_platforms,
          app_store: scrapingSession.app_store_scraper_status,
          google_play: scrapingSession.google_play_scraper_status,
          reddit: scrapingSession.reddit_scraper_status,
          complete: isComplete,
          // 保持兼容性的数据统计
          data_count: {
            total: stats.total_reviews,
            appStore: stats.app_store_reviews,
            googlePlay: stats.google_play_reviews,
            reddit: stats.reddit_posts
          }
        });

        if (isComplete) {
          // 抓取完成，更新状态并触发分析
          await completeReportScraping(supabase, report.id, scrapingSession.id, stats);
          result.completed_reports++;

          // 触发分析
          const analysisTriggered = await triggerAnalysis(supabaseUrl, supabaseKey, report.id, report.app_name, scrapingSession.id, stats);
          if (analysisTriggered) {
            result.triggered_analyses++;
          }
        } else {
          // 检查是否超时
          const waitTime = Date.now() - new Date(scrapingSession.started_at).getTime();
          const waitMinutes = Math.floor(waitTime / (1000 * 60));

          if (waitMinutes > MAX_WAIT_TIME_MINUTES) {
            console.log(`⏰ 报告 ${report.id} 超时 (${waitMinutes}分钟)，强制完成`);
            
            // 超时强制完成
            await completeReportScraping(supabase, report.id, scrapingSession.id, stats);
            result.completed_reports++;

            // 即使超时也尝试触发分析
            const analysisTriggered = await triggerAnalysis(supabaseUrl, supabaseKey, report.id, report.app_name, scrapingSession.id, stats);
            if (analysisTriggered) {
              result.triggered_analyses++;
            }
          } else {
            console.log(`⏳ 报告 ${report.id} 还在等待中 (${waitMinutes}/${MAX_WAIT_TIME_MINUTES}分钟)`);
          }
        }

      } catch (error) {
        console.error(`❌ 处理报告 ${report.id} 时出错:`, error);
        result.errors.push(`处理报告 ${report.id} 失败: ${error.message}`);
      }
    }

    // 3. 记录执行结果
    result.execution_time = Date.now() - startTime;
    
    console.log('📊 抓取监控执行完成:', result);

    // 记录到数据库
    try {
      await supabase
        .from('cron_execution_log')
        .insert({
          function_name: 'cron-scraping-monitor',
          execution_time: result.execution_time,
          result: result,
          executed_at: new Date().toISOString()
        });
    } catch (logError) {
      console.log('监控日志记录失败:', logError);
    }

    return new Response(JSON.stringify({
      success: true,
      message: '抓取监控执行完成',
      result
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('❌ 抓取监控执行失败:', error);
    
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      execution_time: Date.now() - startTime
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

// 🆕 检查抓取是否完成（基于scraper状态）
function checkScrapingComplete(scrapingSession: any): boolean {
  const enabledPlatforms = scrapingSession.enabled_platforms || ['app_store', 'google_play', 'reddit']
  
  console.log(`🔍 Checking completion for platforms: ${enabledPlatforms.join(', ')}`)
  
  const platformStatuses = {
    app_store: scrapingSession.app_store_scraper_status,
    google_play: scrapingSession.google_play_scraper_status,
    reddit: scrapingSession.reddit_scraper_status
  }
  
  // 检查所有启用的平台是否都完成了（completed或failed）
  const allEnabledComplete = enabledPlatforms.every(platform => {
    const status = platformStatuses[platform]
    const isComplete = status === 'completed' || status === 'failed'
    
    console.log(`📊 Platform ${platform}: ${status} (${isComplete ? 'done' : 'pending'})`)
    return isComplete
  })
  
  // 检查是否至少有一个平台成功完成
  const hasSuccessfulPlatform = enabledPlatforms.some(platform => {
    return platformStatuses[platform] === 'completed'
  })
  
  // 计算成功完成的平台数
  const completedPlatforms = enabledPlatforms.filter(platform => 
    platformStatuses[platform] === 'completed'
  ).length
  
  console.log(`📈 Completion status: ${completedPlatforms}/${enabledPlatforms.length} platforms completed`)
  
  // 完成条件：所有启用的平台都结束了 AND 至少有一个平台成功
  return allEnabledComplete && hasSuccessfulPlatform
}

// 计算抓取统计数据（保持向后兼容）
function calculateScrapingStats(reviews: any[]): ScrapingStats {
  const stats: ScrapingStats = {
    total_reviews: reviews.length,
    app_store_reviews: 0,
    google_play_reviews: 0,
    reddit_posts: 0,
    platforms_with_data: 0
  };

  for (const review of reviews) {
    switch (review.platform) {
      case 'app_store':
        stats.app_store_reviews++;
        break;
      case 'google_play':
        stats.google_play_reviews++;
        break;
      case 'reddit':
        stats.reddit_posts++;
        break;
    }
  }

  // 计算有数据的平台数量
  if (stats.app_store_reviews > 0) stats.platforms_with_data++;
  if (stats.google_play_reviews > 0) stats.platforms_with_data++;
  if (stats.reddit_posts > 0) stats.platforms_with_data++;

  return stats;
}

// 检查抓取是否完成
function checkScrapingCompleteOld(scrapingSession: any, stats: ScrapingStats): boolean {
  // 条件1：有足够的数据
  const hasEnoughData = stats.total_reviews >= MIN_REVIEWS_THRESHOLD;
  
  // 条件2：至少有一个平台有数据
  const hasAnyData = stats.platforms_with_data > 0;
  
  // 条件3：等待时间检查（这里不检查超时，超时在主函数中处理）
  const waitTime = Date.now() - new Date(scrapingSession.started_at).getTime();
  const waitMinutes = Math.floor(waitTime / (1000 * 60));
  
  console.log(`🔍 完成检查: 数据量=${stats.total_reviews}, 平台数=${stats.platforms_with_data}, 等待时间=${waitMinutes}分钟`);
  
  return hasEnoughData && hasAnyData;
}

// 完成报告抓取
async function completeReportScraping(supabase: any, reportId: string, scrapingSessionId: string, stats: ScrapingStats) {
  try {
    console.log(`✅ 完成报告 ${reportId} 的抓取`);

    // 更新报告状态
    const { error: reportError } = await supabase
      .from('reports')
      .update({
        status: 'scraping_completed',
        updated_at: new Date().toISOString()
      })
      .eq('id', reportId);

    if (reportError) {
      throw new Error(`更新报告状态失败: ${reportError.message}`);
    }

    // 更新抓取会话状态
    const { error: sessionError } = await supabase
      .from('scraping_sessions')
      .update({
        status: 'completed',
        total_reviews_found: stats.total_reviews,
        app_store_reviews: stats.app_store_reviews,
        google_play_reviews: stats.google_play_reviews,
        reddit_posts: stats.reddit_posts,
        completed_at: new Date().toISOString()
      })
      .eq('id', scrapingSessionId);

    if (sessionError) {
      throw new Error(`更新抓取会话状态失败: ${sessionError.message}`);
    }

    console.log(`✅ 报告 ${reportId} 状态更新完成`);

  } catch (error) {
    console.error(`❌ 完成报告抓取时出错:`, error);
    throw error;
  }
}

// 触发分析
async function triggerAnalysis(supabaseUrl: string, supabaseKey: string, reportId: string, appName: string, scrapingSessionId: string, stats: ScrapingStats): Promise<boolean> {
  try {
    console.log(`🚀 触发报告 ${reportId} 的分析`);

    const response = await fetch(`${supabaseUrl}/functions/v1/start-analysis-v2`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        reportId,
        config: {
          enableParallelProcessing: stats.total_reviews > 100,
          maxConcurrentBatches: 4,
          batchSize: 20,
          priorityMode: 'balanced'
        }
      })
    });

    if (response.ok) {
      const analysisResult = await response.json();
      console.log(`✅ 分析触发成功:`, analysisResult);
      return true;
    } else {
      const errorText = await response.text();
      console.error(`❌ 分析触发失败: ${response.status} - ${errorText}`);
      return false;
    }

  } catch (error) {
    console.error(`❌ 触发分析时出错:`, error);
    return false;
  }
} 