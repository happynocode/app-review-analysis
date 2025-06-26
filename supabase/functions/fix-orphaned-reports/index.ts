/**
 * 修复孤儿报告状态
 * 
 * 这个函数用于修复以下情况：
 * 1. analysis_tasks都已完成，但report状态仍为failed
 * 2. scraping_session已完成，但report状态不正确
 * 
 * 主要解决start-analysis-v2中第一批启动失败导致的状态不一致问题
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('🔍 开始检查孤儿报告...');

    // 查找所有analysis_tasks完成但report状态为failed的报告
    const { data: orphanedReports, error: queryError } = await supabase
      .from('reports')
      .select(`
        id,
        app_name,
        status,
        error_message,
        failure_stage,
        scraping_sessions!inner(
          id,
          status,
          analysis_tasks(
            id,
            status
          )
        )
      `)
      .eq('status', 'failed')
      .eq('failure_stage', 'analysis');

    if (queryError) {
      throw new Error(`查询失败: ${queryError.message}`);
    }

    console.log(`📊 找到 ${orphanedReports?.length || 0} 个可能的孤儿报告`);

    const fixedReports = [];
    const skippedReports = [];

    for (const report of orphanedReports || []) {
      const scrapingSession = report.scraping_sessions[0];
      
      if (!scrapingSession) {
        console.log(`⚠️ 报告 ${report.id} 没有scraping_session，跳过`);
        skippedReports.push({ reportId: report.id, reason: 'no_scraping_session' });
        continue;
      }

      const analysisTasks = scrapingSession.analysis_tasks || [];
      const completedTasks = analysisTasks.filter(task => task.status === 'completed');
      const failedTasks = analysisTasks.filter(task => task.status === 'failed');
      const pendingTasks = analysisTasks.filter(task => task.status === 'pending');

      console.log(`📋 报告 ${report.id} (${report.app_name}): ${completedTasks.length}/${analysisTasks.length} 任务完成`);

      // 如果所有任务都完成了，且scraping_session也完成了
      if (analysisTasks.length > 0 && 
          completedTasks.length === analysisTasks.length && 
          scrapingSession.status === 'completed') {
        
        console.log(`🔧 修复报告 ${report.id}...`);
        
        try {
          // 调用complete-report-analysis来完成报告
          const response = await fetch(`${supabaseUrl}/functions/v1/complete-report-analysis`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseKey}`
            },
            body: JSON.stringify({
              reportId: report.id
            })
          });

          if (response.ok) {
            const result = await response.json();
            console.log(`✅ 报告 ${report.id} 修复成功`);
            fixedReports.push({
              reportId: report.id,
              appName: report.app_name,
              tasksCompleted: completedTasks.length,
              result: result
            });
          } else {
            const errorText = await response.text();
            console.error(`❌ 修复报告 ${report.id} 失败: ${errorText}`);
            skippedReports.push({ 
              reportId: report.id, 
              reason: 'complete_analysis_failed',
              error: errorText 
            });
          }
        } catch (error) {
          console.error(`❌ 修复报告 ${report.id} 异常:`, error);
          skippedReports.push({ 
            reportId: report.id, 
            reason: 'exception',
            error: error.message 
          });
        }
      } else {
        console.log(`⚠️ 报告 ${report.id} 不符合修复条件，跳过`);
        skippedReports.push({ 
          reportId: report.id, 
          reason: 'not_ready_for_completion',
          details: {
            totalTasks: analysisTasks.length,
            completedTasks: completedTasks.length,
            failedTasks: failedTasks.length,
            pendingTasks: pendingTasks.length,
            scrapingStatus: scrapingSession.status
          }
        });
      }
    }

    const summary = {
      totalChecked: orphanedReports?.length || 0,
      fixed: fixedReports.length,
      skipped: skippedReports.length,
      fixedReports,
      skippedReports
    };

    console.log(`📊 修复完成: ${summary.fixed} 个报告已修复, ${summary.skipped} 个跳过`);

    return new Response(JSON.stringify({
      success: true,
      message: '孤儿报告检查和修复完成',
      summary
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('❌ 修复过程失败:', error);
    
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
