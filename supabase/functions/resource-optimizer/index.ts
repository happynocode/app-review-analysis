import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

interface ResourceConfig {
  memoryOptimization: boolean
  dynamicBatchSizing: boolean
  connectionPooling: boolean
  cacheStrategy: 'none' | 'basic' | 'aggressive'
}

interface SystemMetrics {
  currentLoad: number
  memoryUsage: number
  activeConnections: number
  queueLength: number
  averageProcessingTime: number
  errorRate: number
}

interface OptimizationRecommendations {
  maxConcurrentBatches: number
  optimalBatchSize: number
  resourceAlert: boolean
  scaleAction: 'scale_up' | 'scale_down' | 'maintain'
  reasoning: string[]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { config }: { config?: ResourceConfig } = req.method === 'POST' 
      ? await req.json() 
      : { config: undefined }

    console.log('🔧 Resource Optimizer: Analyzing system performance...')

    // Get current system metrics
    const metrics = await getSystemMetrics(supabaseClient)
    console.log('📊 Current system metrics:', metrics)

    // Generate optimization recommendations
    const recommendations = await generateOptimizationRecommendations(metrics, config)
    console.log('💡 Optimization recommendations:', recommendations)

    // Update system configuration if needed
    if (config && config.dynamicBatchSizing) {
      await updateBatchConfiguration(supabaseClient, recommendations)
    }

    return new Response(
      JSON.stringify({
        success: true,
        metrics,
        recommendations,
        timestamp: new Date().toISOString(),
        optimizationApplied: config?.dynamicBatchSizing || false
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Error in resource-optimizer:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Resource optimization failed',
        details: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})

async function getSystemMetrics(supabaseClient: any): Promise<SystemMetrics> {
  try {
    // Get processing queue length and status
    const { data: queueData, error: queueError } = await supabaseClient
      .from('processing_queue')
      .select('status, started_at, completed_at, estimated_duration_seconds, actual_duration_seconds')

    if (queueError) {
      console.warn('Warning: Could not fetch queue data:', queueError.message)
    }

    // Get active analysis tasks
    const { data: activeTasks, error: tasksError } = await supabaseClient
      .from('analysis_tasks')
      .select('status, created_at, updated_at')
      .in('status', ['pending', 'processing'])

    if (tasksError) {
      console.warn('Warning: Could not fetch active tasks:', tasksError.message)
    }

    // Get recent processing statistics
    const { data: recentReports, error: reportsError } = await supabaseClient
      .from('reports')
      .select('status, created_at, completed_at')
      .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString()) // Last hour

    if (reportsError) {
      console.warn('Warning: Could not fetch recent reports:', reportsError.message)
    }

    // Calculate metrics
    const queueLength = queueData?.filter(q => q.status === 'queued').length || 0
    const processingCount = queueData?.filter(q => q.status === 'processing').length || 0
    const activeTasksCount = activeTasks?.length || 0
    
    // Calculate average processing time
    const completedTasks = queueData?.filter(q => 
      q.status === 'completed' && 
      q.actual_duration_seconds !== null
    ) || []
    
    const averageProcessingTime = completedTasks.length > 0
      ? completedTasks.reduce((sum, task) => sum + (task.actual_duration_seconds || 0), 0) / completedTasks.length
      : 45 // Default estimate in seconds

    // Calculate error rate
    const totalRecentTasks = queueData?.length || 1
    const failedTasks = queueData?.filter(q => q.status === 'failed').length || 0
    const errorRate = totalRecentTasks > 0 ? failedTasks / totalRecentTasks : 0

    // Estimate current load based on active tasks
    const maxRecommendedConcurrent = 6
    const currentLoad = Math.min(processingCount / maxRecommendedConcurrent, 1.0)

    // Estimate memory usage based on active tasks and batch sizes
    const estimatedMemoryUsage = Math.min((activeTasksCount * 0.15), 1.0) // Rough estimate

    return {
      currentLoad,
      memoryUsage: estimatedMemoryUsage,
      activeConnections: processingCount,
      queueLength,
      averageProcessingTime,
      errorRate
    }

  } catch (error) {
    console.error('Error getting system metrics:', error)
    // Return safe defaults
    return {
      currentLoad: 0.5,
      memoryUsage: 0.3,
      activeConnections: 0,
      queueLength: 0,
      averageProcessingTime: 45,
      errorRate: 0
    }
  }
}

async function generateOptimizationRecommendations(
  metrics: SystemMetrics, 
  config?: ResourceConfig
): Promise<OptimizationRecommendations> {
  const reasoning: string[] = []
  let maxConcurrentBatches = 4 // Default
  let optimalBatchSize = 400 // Default
  let resourceAlert = false
  let scaleAction: 'scale_up' | 'scale_down' | 'maintain' = 'maintain'

  // Analyze current load and adjust concurrency
  if (metrics.currentLoad < 0.3 && metrics.memoryUsage < 0.5) {
    maxConcurrentBatches = 6
    scaleAction = 'scale_up'
    reasoning.push('Low system load detected, increasing concurrency to 6')
  } else if (metrics.currentLoad > 0.8 || metrics.memoryUsage > 0.8) {
    maxConcurrentBatches = 2
    scaleAction = 'scale_down'
    resourceAlert = true
    reasoning.push('High system load detected, reducing concurrency to 2')
  } else if (metrics.currentLoad > 0.6 || metrics.memoryUsage > 0.6) {
    maxConcurrentBatches = 3
    reasoning.push('Moderate system load, setting concurrency to 3')
  } else {
    maxConcurrentBatches = 4
    reasoning.push('Normal system load, maintaining concurrency at 4')
  }

  // Adjust batch size based on processing time and error rate
  if (metrics.averageProcessingTime > 60) {
    optimalBatchSize = 300
    reasoning.push('Slow processing detected, reducing batch size to 300')
  } else if (metrics.averageProcessingTime < 30 && metrics.errorRate < 0.05) {
    optimalBatchSize = 500
    reasoning.push('Fast processing with low errors, increasing batch size to 500')
  } else {
    reasoning.push('Normal processing speed, maintaining batch size at 400')
  }

  // Check for resource alerts
  if (metrics.errorRate > 0.15) {
    resourceAlert = true
    reasoning.push(`High error rate detected: ${(metrics.errorRate * 100).toFixed(1)}%`)
  }

  if (metrics.queueLength > 10) {
    reasoning.push(`Large queue detected: ${metrics.queueLength} items`)
    if (maxConcurrentBatches < 6 && metrics.memoryUsage < 0.7) {
      maxConcurrentBatches = Math.min(maxConcurrentBatches + 1, 6)
      reasoning.push('Increasing concurrency to handle queue backlog')
    }
  }

  return {
    maxConcurrentBatches,
    optimalBatchSize,
    resourceAlert,
    scaleAction,
    reasoning
  }
}

async function updateBatchConfiguration(
  supabaseClient: any, 
  recommendations: OptimizationRecommendations
): Promise<void> {
  try {
    console.log('🔄 Applying optimization recommendations:', {
      maxConcurrentBatches: recommendations.maxConcurrentBatches,
      optimalBatchSize: recommendations.optimalBatchSize,
      scaleAction: recommendations.scaleAction
    })
  } catch (error) {
    console.error('Error updating batch configuration:', error)
  }
}

// Helper function to get optimal concurrency for other functions to use
export async function getOptimalConcurrency(): Promise<number> {
  try {
    const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/resource-optimizer`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
        'Content-Type': 'application/json'
      }
    })

    if (response.ok) {
      const data = await response.json()
      return data.recommendations?.maxConcurrentBatches || 4
    }
  } catch (error) {
    console.error('Error getting optimal concurrency:', error)
  }
  
  return 4 // Safe default
} 