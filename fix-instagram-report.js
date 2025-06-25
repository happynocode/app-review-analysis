// 修复Instagram报告状态的脚本
// 这个脚本用于修复analysis_tasks都完成但report状态为failed的情况

const SUPABASE_URL = 'https://mihmdokivbllrcrjoojo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1paG1kb2tpdmJsbHJjcmpvb2pvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTAzNTA1ODIsImV4cCI6MjA2NTkyNjU4Mn0.zDp4T5U60hH1V7jgbOz77uACv2nTap84XB54FEQ7RpE';

async function fixInstagramReport() {
  const reportId = '5ce5f313-015c-44b6-a227-ecd1031fbae9';
  
  try {
    console.log('🔧 开始修复Instagram报告...');
    
    // 调用complete-report-analysis Edge Function
    const response = await fetch(`${SUPABASE_URL}/functions/v1/complete-report-analysis`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        reportId: reportId
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ 调用complete-report-analysis失败:', errorText);
      return;
    }
    
    const result = await response.json();
    console.log('✅ 修复成功:', result);
    
  } catch (error) {
    console.error('❌ 修复过程中出错:', error);
  }
}

// 运行修复
fixInstagramReport();
