import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Reddit API configuration
const REDDIT_CLIENT_ID = Deno.env.get('REDDIT_CLIENT_ID')
const REDDIT_CLIENT_SECRET = Deno.env.get('REDDIT_CLIENT_SECRET')
const REDDIT_USER_AGENT = Deno.env.get('REDDIT_USER_AGENT') || 'FeedbackLens/1.0 by YourUsername'

interface ScrapeRequest {
  appName: string // 用户选择的应用名称（从应用列表中选择的完整名称）
  userSearchTerm?: string // 🆕 用户在搜索框输入的原始关键词
  scrapingSessionId?: string
  maxPosts?: number // 移除默认限制
}

interface RedditPost {
  text: string
  title: string
  score: number
  date: string
  subreddit: string
  url: string
  author: string
  searchTerm?: string
  upvoteRatio?: number
  commentCount?: number
  postId?: string
  gilded?: number
  isStickied?: boolean
}

// 搜索任务接口
interface SearchTask {
  term: string
  subreddit?: string
  limit: number
  priority: number // 1=highest, 3=lowest
  type: 'global' | 'subreddit' | 'app-specific' | 'pattern'
}

class RedditAPIClient {
  private accessToken: string | null = null
  private tokenExpiry: number = 0
  private rateLimitDelay = 1000 // 1 second between requests

  constructor() {
    if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET) {
      console.warn('⚠️ Reddit API credentials not configured. Reddit scraping will be limited.')
    }
  }

  private async delay(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms))
  }

  // 获取 Reddit API 访问令牌
  async getAccessToken(): Promise<string | null> {
    if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET) {
      return null
    }

    // 检查现有令牌是否仍然有效
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken
    }

    try {
      console.log('🔐 Obtaining Reddit API access token...')
      
      const credentials = btoa(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`)
      
      const response = await fetch('https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': REDDIT_USER_AGENT
        },
        body: 'grant_type=client_credentials'
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Token request failed: ${response.status} - ${errorText}`)
      }

      const data = await response.json()
      
      if (data.access_token) {
        this.accessToken = data.access_token
        this.tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000 // 减去1分钟作为缓冲
        console.log(`✅ Reddit API token obtained, expires in ${data.expires_in} seconds`)
        return this.accessToken
      } else {
        throw new Error('No access token in response')
      }

    } catch (error) {
      console.error('❌ Failed to obtain Reddit API token:', error.message)
      return null
    }
  }

  // 使用 Reddit API 搜索
  async searchWithAPI(query: string, subreddit?: string, limit: number = 100): Promise<RedditPost[]> {
    const token = await this.getAccessToken()
    if (!token) {
      console.log('⚠️ No Reddit API token available, skipping API search')
      return []
    }

    try {
      let searchUrl = 'https://oauth.reddit.com/search'
      const params = new URLSearchParams({
        q: query,
        sort: 'relevance',
        t: 'year', // 🆕 限制在一年内的帖子
        limit: limit.toString(),
        type: 'link'
      })

      if (subreddit) {
        params.append('restrict_sr', 'true')
        searchUrl = `https://oauth.reddit.com/r/${subreddit}/search`
      }

      const fullUrl = `${searchUrl}?${params.toString()}`
      
      console.log(`🔍 Reddit API search: ${subreddit ? `r/${subreddit}` : 'all'} for "${query}"`)
      
      const response = await fetch(fullUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'User-Agent': REDDIT_USER_AGENT
        }
      })

      if (!response.ok) {
        if (response.status === 401) {
          // Token expired, clear it
          this.accessToken = null
          this.tokenExpiry = 0
        }
        throw new Error(`API search failed: ${response.status}`)
      }

      const data = await response.json()
      
      if (data?.data?.children) {
        const posts = this.parseRedditAPIData(data.data.children, query)
        console.log(`✅ Reddit API found ${posts.length} posts`)
        return posts
      }

      return []

    } catch (error) {
      console.error(`❌ Reddit API search error for "${query}":`, error.message)
      return []
    }
  }

  // 解析 Reddit API 数据
  private parseRedditAPIData(children: any[], searchTerm: string): RedditPost[] {
    const posts: RedditPost[] = []

    for (const child of children) {
      try {
        const post = child.data
        if (!post) continue

        // 过滤掉被删除或移除的帖子
        if (post.removed_by_category || post.banned_by || 
            post.title === '[removed]' || post.title === '[deleted]') {
          continue
        }

        const title = post.title || ''
        const selftext = post.selftext || ''
        const content = selftext || title

        // 最小内容长度检查
        if (content.length < 20) continue

        posts.push({
          text: content,
          title: title,
          score: post.score || 0,
          date: new Date(post.created_utc * 1000).toISOString().split('T')[0],
          subreddit: post.subreddit || 'unknown',
          url: `https://reddit.com${post.permalink}`,
          author: post.author || 'Anonymous',
          searchTerm: searchTerm,
          upvoteRatio: post.upvote_ratio || 0,
          commentCount: post.num_comments || 0,
          postId: post.id || '',
          gilded: post.gilded || 0,
          isStickied: post.stickied || false
        })

      } catch (error) {
        console.error('Error parsing Reddit API post:', error)
        continue
      }
    }

    return posts
  }
}

// 并行批处理器
class BatchProcessor {
  private maxConcurrency: number
  private batchDelay: number
  private requestTimeout: number

  constructor(maxConcurrency = 8, batchDelay = 300, requestTimeout = 10000) {
    this.maxConcurrency = maxConcurrency
    this.batchDelay = batchDelay
    this.requestTimeout = requestTimeout
  }

  // 并行执行搜索任务
  async processBatches<T>(
    tasks: Array<() => Promise<T>>,
    onProgress?: (completed: number, total: number) => void
  ): Promise<T[]> {
    const results: T[] = []
    let completed = 0

    for (let i = 0; i < tasks.length; i += this.maxConcurrency) {
      const batch = tasks.slice(i, i + this.maxConcurrency)
      
      console.log(`🔄 Processing batch ${Math.floor(i / this.maxConcurrency) + 1}/${Math.ceil(tasks.length / this.maxConcurrency)} (${batch.length} tasks)`)
      
      try {
        // 并行执行当前批次的任务
        const batchResults = await Promise.allSettled(
          batch.map(task => this.withTimeout(task(), this.requestTimeout))
        )

        // 收集成功的结果
        for (const result of batchResults) {
          if (result.status === 'fulfilled' && result.value) {
            results.push(result.value)
          } else if (result.status === 'rejected') {
            console.warn(`⚠️ Task failed:`, result.reason?.message || 'Unknown error')
          }
        }

        completed += batch.length
        onProgress?.(completed, tasks.length)

        // 批次间延迟
        if (i + this.maxConcurrency < tasks.length) {
          await this.delay(this.batchDelay)
        }

      } catch (error) {
        console.error(`❌ Batch processing error:`, error)
      }
    }

    return results
  }

  // 超时包装器
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
    })
    
    return Promise.race([promise, timeoutPromise])
  }

  private async delay(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms))
  }
}

class OptimizedRedditScraper {
  private apiClient: RedditAPIClient
  private batchProcessor: BatchProcessor
  private seenPostIds: Set<string>

  constructor() {
    this.apiClient = new RedditAPIClient()
    this.batchProcessor = new BatchProcessor(8, 300, 12000) // 8并发，300ms批次延迟，12秒超时
    this.seenPostIds = new Set()
  }

  // 🆕 简化的关键词生成：只使用核心词汇+特定后缀
  private generateOptimizedSearchTerms(userSearchTerm?: string, appName?: string): string[] {
    const searchTerms = new Set<string>()
    
    console.log(`🔧 Generating simplified search terms - User: "${userSearchTerm || 'none'}", App: "${appName || 'none'}"`)
    
    // 确定核心搜索词：优先使用用户搜索词，其次是应用名的核心关键词
    let coreSearchTerm = ''
    
    if (userSearchTerm && userSearchTerm.trim().length > 0) {
      coreSearchTerm = userSearchTerm.trim().toLowerCase()
      console.log(`🎯 Using user search term as core: "${coreSearchTerm}"`)
    } else if (appName && appName.trim().length > 0) {
      // 从应用名提取第一个核心关键词
      const appKeywords = this.extractSimpleAppKeywords(appName)
      if (appKeywords.length > 0) {
        coreSearchTerm = appKeywords[0]
        console.log(`📱 Using app keyword as core: "${coreSearchTerm}"`)
      }
    }
    
    // 如果没有有效的核心搜索词，返回空数组
    if (!coreSearchTerm || coreSearchTerm.length < 2) {
      console.log('⚠️ No valid core search term found')
      return []
    }
    
    // 定义搜索后缀 - 扩展版本
    const searchSuffixes = [
      // 评价相关
      'review',
      'reviews',
      'rating',
      'ratings',
      'opinion',
      'opinions',
      'feedback',
      'thoughts',
      
      // 平台相关
      'app',
      'application',
      'ios',
      'android',
      'mobile',
      'download',
      
      // 问题相关
      'issue',
      'issues',
      'problem',
      'problems',
      'bug',
      'bugs',
      'error',
      'errors',
      'crash',
      'crashes',
      'glitch',
      'glitches',
      
      // 体验相关
      'experience',
      'experiences',
      'using',
      'tried',
      'testing',
      'working',
      'not working',
      'broken',
      'fixed',
      
      // 比较相关
      'vs',
      'versus',
      'compared to',
      'alternative',
      'alternatives',
      'better than',
      'worse than',
      'similar to',
      
      // 推荐相关
      'recommend',
      'recommendation',
      'worth it',
      'good',
      'bad',
      'terrible',
      'awesome',
      'amazing',
      'disappointing',
      
      // 功能相关
      'update',
      'updates',
      'new version',
      'latest version',
      'feature',
      'features',
      'settings',
      'setup',
      
      // 使用相关
      'how to use',
      'tutorial',
      'guide',
      'tips',
      'tricks',
      'help'
    ]
    
    // 生成核心词汇+后缀的组合
    for (const suffix of searchSuffixes) {
      searchTerms.add(`${coreSearchTerm} ${suffix}`)
    }
    
    // 也添加单独的核心词汇
    searchTerms.add(coreSearchTerm)
    searchTerms.add(`"${coreSearchTerm}"`) // 精确匹配
    
    // 转换为数组并过滤
    const finalTerms = Array.from(searchTerms)
      .filter(term => {
        // 基本验证
        if (!term || term.length < 3 || term.length > 40) return false
        if (term.includes('undefined') || term.includes('null')) return false
        
        // 避免包含HTML实体或特殊编码
        if (term.includes('&amp;') || term.includes('&quot;')) return false
        
        return true
      })
      .slice(0, 25) // 增加到最多25个搜索词以获得更多覆盖

    console.log(`📝 Generated ${finalTerms.length} expanded search terms:`, finalTerms)
    return finalTerms
  }

  // 🆕 从应用名提取简单关键词的辅助方法
  private extractSimpleAppKeywords(appName: string): string[] {
    // 清理应用名：去掉特殊字符和常见后缀
    let cleanAppName = appName
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ') // 移除特殊字符
      .replace(/\s+-\s+/g, ' ') // 移除 " - "
      .replace(/\b(app|application|mobile|inc|llc|ltd|corp|company|&amp|amp)\b/gi, ' ') // 移除常见后缀
      .replace(/\s+/g, ' ') // 合并多个空格
      .trim()
    
    console.log(`🔧 Cleaned app name: "${appName}" -> "${cleanAppName}"`)
    
    // 提取有意义的词汇
    const keywords = cleanAppName.split(/\s+/)
      .filter(word => word.length > 2)
      .filter(word => !['the', 'and', 'for', 'with', 'app', 'mobile', 'application', 'drive', 'deliver', 'driver'].includes(word.toLowerCase()))
      .slice(0, 3) // 只取前3个最重要的词
    
    console.log(`🎯 Extracted app keywords:`, keywords)
    return keywords
  }

  // 获取重点 subreddits（增强版）
  private getTargetSubreddits(): string[] {
    return [
      // 应用和软件相关 (高优先级)
      'apps', 'androidapps', 'iosapps', 'AppReviews', 'software', 'SoftwareRecommendations',
      'AppHookup', 'AppleWatch', 'iPhone', 'iPad', 'Android', 'GooglePlay', 'AppStore',
      
      // 技术和平台相关
      'technology', 'tech', 'TechSupport', 'TechReviews', 'gadgets', 'apple', 'google',
      'microsoft', 'opensource', 'Programming', 'webdev', 'MacApps', 'WindowsApps',
      
      // 生产力和工作相关
      'productivity', 'ProductivityApps', 'WorkflowApps', 'studytips', 'LifeProTips',
      'GetStudying', 'organization', 'selfimprovement',
      
      // 用户讨论和推荐
      'AskReddit', 'NoStupidQuestions', 'tipofmytongue', 'HelpMeFind', 'findareddit',
      'reviews', 'BuyItForLife', 'YouShouldKnow', 'LifeHacks',
      
      // 游戏和娱乐相关
      'gaming', 'AndroidGaming', 'iosGaming', 'GameReviews', 'MobileGaming',
      'indiegames', 'GameDeals', 'Steam',
      
      // 社交和通讯相关
      'socialmedia', 'privacy', 'security', 'Telegram', 'WhatsApp', 'Signal',
      'Instagram', 'Twitter', 'Facebook', 'TikTok', 'YouTube',
      
      // 金融和商务相关
      'personalfinance', 'investing', 'CryptoCurrency', 'Entrepreneur', 'smallbusiness',
      'Banking', 'FinTech', 'ecommerce', 'startups',
      
      // 设计和创意
      'Design', 'GraphicDesign', 'UserExperience', 'UI_Design', 'web_design',
      'photography', 'AdobeIllustrator', 'photoshop',
      
      // 健康和生活方式
      'fitness', 'nutrition', 'loseit', 'getmotivated', 'selfcare',
      'meditation', 'sleep', 'running', 'bodyweightfitness'
    ]
  }

  // 🆕 简化的应用特定subreddit生成
  private generateAppSpecificSubreddits(userSearchTerm?: string, appName?: string): string[] {
    const appSubreddits: string[] = []
    
    console.log(`🎯 Generating simplified app-specific subreddits - User: "${userSearchTerm || 'none'}", App: "${appName || 'none'}"`)
    
    // 确定核心搜索词：优先使用用户搜索词，其次是应用名的核心关键词
    let coreSearchTerm = ''
    
    if (userSearchTerm && userSearchTerm.trim().length > 0) {
      coreSearchTerm = userSearchTerm.trim().toLowerCase()
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, '')
      console.log(`🎯 Using user search term for subreddits: "${coreSearchTerm}"`)
    } else if (appName && appName.trim().length > 0) {
      const appKeywords = this.extractSimpleAppKeywords(appName)
      if (appKeywords.length > 0) {
        coreSearchTerm = appKeywords[0].replace(/[^\w\s]/g, '').replace(/\s+/g, '')
        console.log(`📱 Using app keyword for subreddits: "${coreSearchTerm}"`)
      }
    }
    
    // 如果有有效的核心搜索词，生成可能的subreddit名称
    if (coreSearchTerm && coreSearchTerm.length >= 3 && coreSearchTerm.length <= 15) {
      appSubreddits.push(coreSearchTerm)
      
      // 只对知名品牌添加最相关的后缀
      const knownBrands = ['uber', 'lyft', 'doordash', 'grubhub', 'postmates', 'spotify', 'netflix', 'amazon', 'google', 'apple', 'microsoft']
      if (knownBrands.includes(coreSearchTerm)) {
        // 只添加最常见和相关的后缀
        if (['uber', 'lyft', 'doordash', 'grubhub', 'postmates'].includes(coreSearchTerm)) {
          appSubreddits.push(`${coreSearchTerm}driver`)
          appSubreddits.push(`${coreSearchTerm}drivers`)
        }
      }
    }
    
    // 过滤并返回合理的subreddit名称
    const uniqueSubreddits = [...new Set(appSubreddits)]
      .filter(sub => {
        // 基本格式检查
        if (sub.length < 3 || sub.length > 21) return false
        if (!/^[a-z0-9]+$/i.test(sub)) return false
        return true
      })
      .slice(0, 3) // 只保留最多3个相关的subreddit

    console.log(`🎯 Generated ${uniqueSubreddits.length} simplified app-specific subreddits:`, uniqueSubreddits)
    return uniqueSubreddits
  }

  // 🚀 优化的主搜索方法：并行批处理策略
  async scrapeReddit(userSearchTerm?: string, appName?: string, maxPosts?: number): Promise<RedditPost[]> {
    const allPosts: RedditPost[] = []
    
    console.log(`\n🚀 === OPTIMIZED PARALLEL REDDIT SCRAPER ===`)
    console.log(`👤 User search term: "${userSearchTerm || 'not provided'}"`)
    console.log(`📱 App name: "${appName || 'not provided'}"`)
    console.log(`🔑 Reddit API: ${REDDIT_CLIENT_ID ? 'Configured' : 'Not configured'}`)
    console.log(`📊 Target max posts: ${maxPosts || 'unlimited - scraping all posts'}`)
    console.log(`⚡ Parallel processing: 8 concurrent requests`)
    console.log(`⏰ Start Time: ${new Date().toISOString()}`)

    // 检查API可用性
    if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET) {
      console.error('❌ Reddit API credentials not configured. Cannot proceed with scraping.')
      return []
    }

    // 清空已见帖子ID集合
    this.seenPostIds.clear()

    const searchTerms = this.generateOptimizedSearchTerms(userSearchTerm, appName)
    const generalSubreddits = this.getTargetSubreddits()
    const appSpecificSubreddits = this.generateAppSpecificSubreddits(userSearchTerm, appName)

    console.log(`🎯 Search terms generated: ${searchTerms.length}`)
    console.log(`📡 General subreddits: ${generalSubreddits.length}`)
    console.log(`🎪 App-specific subreddits: ${appSpecificSubreddits.length}`)

    try {
      // 创建搜索任务队列
      const searchTasks: SearchTask[] = []

      // 1. 全局搜索任务 (最高优先级)
      for (const term of searchTerms.slice(0, 15)) {
        searchTasks.push({
          term,
          limit: 100,
          priority: 1,
          type: 'global'
        })
      }

      // 2. 热门subreddit搜索任务
      const topSubreddits = generalSubreddits.slice(0, 12) // 选择最重要的12个
      for (const subreddit of topSubreddits) {
        for (const term of searchTerms.slice(0, 6)) { // 每个subreddit只搜索6个最重要的关键词
          searchTasks.push({
            term,
            subreddit,
            limit: 50,
            priority: 2,
            type: 'subreddit'
          })
        }
      }

      // 3. 应用特定subreddit搜索任务
      for (const appSubreddit of appSpecificSubreddits.slice(0, 8)) { // 限制到8个应用特定subreddit
        for (const term of searchTerms.slice(0, 4)) { // 每个应用subreddit搜索4个关键词
          searchTasks.push({
            term,
            subreddit: appSubreddit,
            limit: 30,
            priority: 2,
            type: 'app-specific'
          })
        }
      }

      // 4. 高价值模式搜索任务
      if (userSearchTerm || appName) {
        const coreSearchTerm = userSearchTerm?.trim().toLowerCase() || 
          this.extractSimpleAppKeywords(appName || '')[0]
        
        if (coreSearchTerm && coreSearchTerm.length > 2) {
          const highValueSuffixes = ['vs', 'alternative', 'better than', 'review', 'opinion']
          for (const suffix of highValueSuffixes) {
            searchTasks.push({
              term: `${coreSearchTerm} ${suffix}`,
              limit: 40,
              priority: 1,
              type: 'pattern'
            })
          }
        }
      }

      // 按优先级排序任务
      searchTasks.sort((a, b) => a.priority - b.priority)

      console.log(`📋 Total search tasks created: ${searchTasks.length}`)
      console.log(`🔥 High priority tasks: ${searchTasks.filter(t => t.priority === 1).length}`)
      console.log(`📊 Medium priority tasks: ${searchTasks.filter(t => t.priority === 2).length}`)

      // 创建搜索函数
      const searchFunctions = searchTasks.map(task => async () => {
        try {
          const posts = await this.apiClient.searchWithAPI(task.term, task.subreddit, task.limit)
          
          // 实时去重
          const newPosts = posts.filter(post => {
            const postKey = post.postId || `${post.title}_${post.author}_${post.date}`
            if (this.seenPostIds.has(postKey)) {
              return false
            }
            this.seenPostIds.add(postKey)
            return true
          })

          console.log(`✅ ${task.type} "${task.term}"${task.subreddit ? ` in r/${task.subreddit}` : ''}: ${newPosts.length} new posts`)
          return newPosts
        } catch (error) {
          console.warn(`⚠️ Search failed for "${task.term}": ${error.message}`)
          return []
        }
      })

      // 并行批处理执行
      console.log(`\n⚡ === PARALLEL BATCH PROCESSING ===`)
      const batchResults = await this.batchProcessor.processBatches(
        searchFunctions,
        (completed, total) => {
          const percentage = ((completed / total) * 100).toFixed(1)
          console.log(`📊 Progress: ${completed}/${total} tasks completed (${percentage}%)`)
        }
      )

      // 收集所有结果
      for (const posts of batchResults) {
        if (Array.isArray(posts)) {
          allPosts.push(...posts)
        }
      }

      console.log(`✅ Parallel Reddit search completed: ${allPosts.length} unique posts collected`)

    } catch (error) {
      console.error('❌ Parallel Reddit search failed:', error.message)
    }

    // 最终排序和限制
    const sortedPosts = allPosts.sort((a, b) => {
      // 优先考虑分数
      if (b.score !== a.score) return b.score - a.score
      // 然后考虑评论数量
      return (b.commentCount || 0) - (a.commentCount || 0)
    })

    const finalPosts = maxPosts ? sortedPosts.slice(0, maxPosts) : sortedPosts
    
    console.log(`\n🎯 === OPTIMIZED REDDIT SCRAPING COMPLETED ===`)
    console.log(`📊 Total unique posts: ${allPosts.length}`)
    console.log(`✨ Final posts (after limit): ${finalPosts.length}`)
    console.log(`⚡ Parallel processing used`)
    console.log(`🎯 Task-based search strategy`)
    console.log(`🔄 Real-time deduplication`)
    console.log(`⏰ End Time: ${new Date().toISOString()}`)
    
    return finalPosts
  }
}

// 主处理函数
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { 
      appName, 
      userSearchTerm, // 🆕 接收用户原始搜索词
      scrapingSessionId, 
      maxPosts // 移除默认的400限制 
    }: ScrapeRequest = await req.json()

    // 至少需要一个搜索条件
    if (!appName && !userSearchTerm) {
      return new Response(
        JSON.stringify({ error: 'Missing appName or userSearchTerm parameter' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    console.log(`🚀 Optimized Reddit scraping started`)
    console.log(`👤 User search term: "${userSearchTerm || 'not provided'}"`)
    console.log(`📱 App name: "${appName || 'not provided'}"`)
    console.log(`🔑 Reddit API status: ${REDDIT_CLIENT_ID ? 'Configured' : 'Not configured'}`)
    console.log(`📊 Target max posts: ${maxPosts || 'unlimited - scraping all posts'}`)

    const scraper = new OptimizedRedditScraper()
    const posts = await scraper.scrapeReddit(userSearchTerm, appName, maxPosts)

    // 保存到数据库并更新scraper状态
    if (scrapingSessionId) {
      try {
        console.log(`💾 Saving ${posts.length} posts to database...`)
        
        const supabaseClient = createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        // 更新scraper状态为running
        await supabaseClient
          .from('scraping_sessions')
          .update({
            reddit_scraper_status: 'running',
            reddit_started_at: new Date().toISOString()
          })
          .eq('id', scrapingSessionId)

        const postsToSave = posts.map(post => ({
          scraping_session_id: scrapingSessionId,
          platform: 'reddit' as const,
          review_text: post.text,
          rating: null,
          review_date: post.date,
          author_name: post.author,
          source_url: post.url,
          additional_data: {
            title: post.title,
            score: post.score,
            subreddit: post.subreddit,
            search_term: post.searchTerm,
            upvote_ratio: post.upvoteRatio,
            comment_count: post.commentCount,
            post_id: post.postId,
            gilded: post.gilded,
            is_stickied: post.isStickied,
            scraper_version: 'enhanced_api_v7.0',
            user_search_term: userSearchTerm, // 🆕 记录用户搜索词
            app_name_used: appName, // 🆕 记录应用名
            search_strategy: 'user_term_priority_enhanced'
          }
        }))

        // 分批保存
        const batchSize = 50
        for (let i = 0; i < postsToSave.length; i += batchSize) {
          const batch = postsToSave.slice(i, i + batchSize)
          
          const { error: saveError } = await supabaseClient
            .from('scraped_reviews')
            .insert(batch)

          if (saveError) {
            console.error(`❌ Database save error for batch ${Math.floor(i/batchSize) + 1}:`, saveError)
          } else {
            console.log(`✅ Saved batch ${Math.floor(i/batchSize) + 1}: ${batch.length} posts`)
          }
        }

        console.log(`✅ Successfully saved all ${postsToSave.length} Reddit posts to database`)
        console.log(`📊 === REDDIT SCRAPING & SAVING SUMMARY ===`)
        console.log(`🔍 Total posts scraped from Reddit API: ${posts.length}`)
        console.log(`💾 Total posts saved to database: ${postsToSave.length}`)
        console.log(`📈 Save success rate: ${postsToSave.length > 0 ? '100%' : '0%'}`)
        console.log(`🎯 User search term: "${userSearchTerm || 'not provided'}"`)
        console.log(`📱 App name used: "${appName || 'not provided'}"`)
        console.log(`⏰ Scraping completed at: ${new Date().toISOString()}`)

        // 🆕 查询实际保存到数据库的reddit数量
        const { count: actualSavedCount, error: countError } = await supabaseClient
          .from('scraped_reviews')
          .select('*', { count: 'exact', head: true })
          .eq('scraping_session_id', scrapingSessionId)
          .eq('platform', 'reddit');

        const finalRedditCount = actualSavedCount || 0;
        console.log(`📊 Reddit实际保存数量: ${finalRedditCount} (原计划: ${posts.length})`);

        // 更新scraper状态为completed（删除review数量字段）
        await supabaseClient
          .from('scraping_sessions')
          .update({
            reddit_scraper_status: 'completed',
            reddit_completed_at: new Date().toISOString()
          })
          .eq('id', scrapingSessionId)

        console.log(`✅ Reddit scraper status updated to completed`)

      } catch (saveError) {
        console.error('❌ Error saving Reddit posts to database:', saveError)

        // 更新scraper状态为failed
        try {
          const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
          )
          
          await supabaseClient
            .from('scraping_sessions')
            .update({
              reddit_scraper_status: 'failed',
              reddit_completed_at: new Date().toISOString(),
              reddit_error_message: saveError.message
            })
            .eq('id', scrapingSessionId)
        } catch (updateError) {
          console.error('❌ Failed to update scraper status:', updateError)
        }
      }
    }

    // 计算统计信息
    const stats = {
      totalPosts: posts.length,
      targetMaxPosts: maxPosts || 'unlimited',
      subreddits: [...new Set(posts.map(p => p.subreddit))],
      averageScore: posts.length > 0 ? Math.round(posts.reduce((sum, p) => sum + p.score, 0) / posts.length) : 0,
      dateRange: posts.length > 0 ? {
        earliest: Math.min(...posts.map(p => new Date(p.date).getTime())),
        latest: Math.max(...posts.map(p => new Date(p.date).getTime()))
      } : null,
      searchStrategy: {
        userSearchTerm: userSearchTerm || null,
        appNameUsed: appName || null,
        strategy: 'user_term_priority_enhanced_api'
      },
      apiUsed: REDDIT_CLIENT_ID ? true : false,
      gildedPosts: posts.filter(p => (p.gilded || 0) > 0).length
    }

    console.log(`\n📊 === OPTIMIZED REDDIT SCRAPING STATISTICS ===`)
    console.log(`✅ Total posts scraped: ${stats.totalPosts}`)
    console.log(`🎯 Target was: ${stats.targetMaxPosts}`)
    console.log(`📈 Achievement rate: ${typeof stats.targetMaxPosts === 'number' ? ((stats.totalPosts / stats.targetMaxPosts) * 100).toFixed(1) + '%' : 'unlimited mode'}`)
    console.log(`📈 Average Reddit score: ${stats.averageScore}`)
    console.log(`🏷️ Subreddits found: ${stats.subreddits.length}`)
    console.log(`🔑 Reddit API used: ${stats.apiUsed}`)
    console.log(`🏆 Gilded posts: ${stats.gildedPosts}`)
    console.log(`💾 Posts that will be saved to database: ${stats.totalPosts}`)
    console.log(`⚡ Performance: Optimized parallel processing used`)

    return new Response(
      JSON.stringify({ 
        posts,
        stats,
        message: `🚀 OPTIMIZED Reddit scraping completed: ${posts.length} posts scraped and saved to database using parallel processing with user search term "${userSearchTerm || 'not provided'}" and app keywords from "${appName || 'not provided'}"`,
        timestamp: new Date().toISOString(),
        scraper_version: 'enhanced_api_v7.0',
        search_optimization: {
          user_term_priority: true,
          app_name_keywords: true,
          enhanced_api_strategy: true,
          app_specific_subreddits: true,
          advanced_search_patterns: true
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('❌ Critical error in Optimized Reddit scraping:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Failed to scrape Reddit',
        details: error.message,
        posts: [],
        stats: {
          totalPosts: 0,
          errorCount: 1,
          scraper_version: 'enhanced_api_v7.0'
        },
        timestamp: new Date().toISOString()
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})