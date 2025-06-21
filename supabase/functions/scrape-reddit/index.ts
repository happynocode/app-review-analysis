import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Reddit API configuration
const REDDIT_CLIENT_ID = Deno.env.get('REDDIT_CLIENT_ID')
const REDDIT_CLIENT_SECRET = Deno.env.get('REDDIT_CLIENT_SECRET')
const REDDIT_USER_AGENT = Deno.env.get('REDDIT_USER_AGENT') || 'ReviewInsight/1.0 by YourUsername'

interface ScrapeRequest {
  appName: string // 用户选择的应用名称（从应用列表中选择的完整名称）
  userSearchTerm?: string // 🆕 用户在搜索框输入的原始关键词
  scrapingSessionId?: string
  maxPosts?: number
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

class OptimizedRedditScraper {
  private apiClient: RedditAPIClient

  constructor() {
    this.apiClient = new RedditAPIClient()
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

  // 🚀 增强的主搜索方法：扩展的 Reddit API 策略
  async scrapeReddit(userSearchTerm?: string, appName?: string, maxPosts: number = 400): Promise<RedditPost[]> {
    const allPosts: RedditPost[] = []
    
    console.log(`\n🚀 === ENHANCED REDDIT SCRAPER (EXPANDED API STRATEGY) ===`)
    console.log(`👤 User search term: "${userSearchTerm || 'not provided'}"`)
    console.log(`📱 App name: "${appName || 'not provided'}"`)
    console.log(`🔑 Reddit API: ${REDDIT_CLIENT_ID ? 'Configured' : 'Not configured'}`)
    console.log(`📊 Target max posts: ${maxPosts}`)
    console.log(`⏰ Start Time: ${new Date().toISOString()}`)

    // 检查API可用性
    if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET) {
      console.error('❌ Reddit API credentials not configured. Cannot proceed with scraping.')
      return []
    }

    const searchTerms = this.generateOptimizedSearchTerms(userSearchTerm, appName)
    const generalSubreddits = this.getTargetSubreddits()
    const appSpecificSubreddits = this.generateAppSpecificSubreddits(userSearchTerm, appName)
    const allSubreddits = [...generalSubreddits, ...appSpecificSubreddits]

    console.log(`🌍 Total search terms: ${searchTerms.length}`)
    console.log(`📡 General subreddits: ${generalSubreddits.length}`)
    console.log(`🎯 App-specific subreddits: ${appSpecificSubreddits.length}`)
    console.log(`📊 Total subreddits to search: ${allSubreddits.length}`)

    try {
      // 策略1: 扩展的全局搜索 - 更多关键词
      console.log(`\n🌍 === ENHANCED GLOBAL SEARCH ===`)
      for (const term of searchTerms.slice(0, 15)) { // 增加到15个关键词
        console.log(`🔍 Global search for: "${term}"`)
        const apiPosts = await this.apiClient.searchWithAPI(term, undefined, 60) // 增加每次搜索的数量
        allPosts.push(...apiPosts)
        console.log(`✅ Global search "${term}": ${apiPosts.length} posts`)
        await this.delay(1000)
      }

      // 策略2: 重点通用 subreddit 搜索
      console.log(`\n📡 === ENHANCED TARGETED SUBREDDIT SEARCH ===`)
      for (const subreddit of generalSubreddits.slice(0, 15)) { // 增加到15个通用subreddit
        for (const term of searchTerms.slice(0, 8)) { // 每个subreddit搜索8个关键词
          console.log(`🔍 r/${subreddit} search for: "${term}"`)
          const subredditPosts = await this.apiClient.searchWithAPI(term, subreddit, 30)
          allPosts.push(...subredditPosts)
          console.log(`✅ r/${subreddit} "${term}": ${subredditPosts.length} posts`)
          await this.delay(800) // 稍微减少延迟以提高效率
        }
      }

      // 策略3: 应用特定 subreddit 搜索
      console.log(`\n🎯 === APP-SPECIFIC SUBREDDIT SEARCH ===`)
      for (const appSubreddit of appSpecificSubreddits) {
        for (const term of searchTerms.slice(0, 6)) { // 每个应用特定subreddit搜索6个关键词
          console.log(`🔍 r/${appSubreddit} search for: "${term}"`)
          try {
            const appSpecificPosts = await this.apiClient.searchWithAPI(term, appSubreddit, 20)
            allPosts.push(...appSpecificPosts)
            console.log(`✅ r/${appSubreddit} "${term}": ${appSpecificPosts.length} posts`)
          } catch (error) {
            // 某些应用特定的subreddit可能不存在，这是正常的
            console.log(`⚠️ r/${appSubreddit} not found or accessible`)
          }
          await this.delay(800)
        }
      }

      // 策略4: 简化的高级搜索模式 - 只使用核心词汇+高价值后缀
      console.log(`\n🔬 === SIMPLIFIED ADVANCED SEARCH ===`)
      
      // 确定核心搜索词
      let coreSearchTerm = ''
      if (userSearchTerm && userSearchTerm.trim().length > 0) {
        coreSearchTerm = userSearchTerm.trim().toLowerCase()
        console.log(`🎯 Using user search term for advanced patterns: "${coreSearchTerm}"`)
      } else if (appName && appName.trim().length > 0) {
        const appKeywords = this.extractSimpleAppKeywords(appName)
        if (appKeywords.length > 0) {
          coreSearchTerm = appKeywords[0]
          console.log(`📱 Using app keyword for advanced patterns: "${coreSearchTerm}"`)
        }
      }
      
      // 如果有有效的核心搜索词，只搜索最高价值的组合
      if (coreSearchTerm && coreSearchTerm.length > 2) {
        const highValueSuffixes = ['vs', 'alternative', 'better than']
        
        for (const suffix of highValueSuffixes) {
          const pattern = `${coreSearchTerm} ${suffix}`
          console.log(`🔍 High-value pattern search: "${pattern}"`)
          const patternPosts = await this.apiClient.searchWithAPI(pattern, undefined, 20)
          allPosts.push(...patternPosts)
          console.log(`✅ High-value pattern "${pattern}": ${patternPosts.length} posts`)
          await this.delay(1000)
        }
      }

      console.log(`✅ Enhanced Reddit API search completed: ${allPosts.length} posts collected`)

    } catch (error) {
      console.error('❌ Enhanced Reddit API search failed:', error.message)
    }

    // 简单去重
    const uniquePosts = this.deduplicatePosts(allPosts)
    
    console.log(`\n🎯 === ENHANCED REDDIT SCRAPING COMPLETED ===`)
    console.log(`📊 Total posts collected: ${allPosts.length}`)
    console.log(`✨ Final unique posts: ${uniquePosts.length}`)
    console.log(`🔑 Enhanced API strategy used`)
    console.log(`🌍 Global searches: ${Math.min(searchTerms.length, 10)}`)
    console.log(`📡 General subreddits searched: ${Math.min(generalSubreddits.length, 15)}`)
    console.log(`🎯 App-specific subreddits searched: ${appSpecificSubreddits.length}`)
    console.log(`🔬 Advanced patterns searched: up to 6`)
    console.log(`⏰ End Time: ${new Date().toISOString()}`)
    
    return uniquePosts.slice(0, maxPosts) // 限制最终数量
  }

  private async delay(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms))
  }

  // 简单去重方法
  private deduplicatePosts(posts: RedditPost[]): RedditPost[] {
    const seen = new Set<string>()
    const uniquePosts: RedditPost[] = []

    for (const post of posts) {
      // 使用帖子ID作为唯一标识符
      const key = post.postId || `${post.title}_${post.author}_${post.date}`
      
      if (!seen.has(key) && post.text.length > 20) {
        seen.add(key)
        uniquePosts.push(post)
      }
    }

    // 按相关性和分数排序
    return uniquePosts.sort((a, b) => {
      // 优先考虑分数
      if (b.score !== a.score) return b.score - a.score
      // 然后考虑评论数量
      return (b.commentCount || 0) - (a.commentCount || 0)
    })
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
      maxPosts = 400 
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
    console.log(`📊 Target max posts: ${maxPosts}`)

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

        // 更新scraper状态为completed
        await supabaseClient
          .from('scraping_sessions')
          .update({
            reddit_scraper_status: 'completed',
            reddit_completed_at: new Date().toISOString(),
            reddit_posts: posts.length
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
      targetMaxPosts: maxPosts,
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
    console.log(`✅ Total posts: ${stats.totalPosts}`)
    console.log(`🎯 Target was: ${stats.targetMaxPosts}`)
    console.log(`📈 Achievement rate: ${((stats.totalPosts / stats.targetMaxPosts) * 100).toFixed(1)}%`)
    console.log(`📈 Average Reddit score: ${stats.averageScore}`)
    console.log(`🏷️ Subreddits found: ${stats.subreddits.length}`)
    console.log(`🔑 Reddit API used: ${stats.apiUsed}`)
    console.log(`🏆 Gilded posts: ${stats.gildedPosts}`)

    return new Response(
      JSON.stringify({ 
        posts,
        stats,
        message: `Enhanced Reddit scraping completed: ${posts.length} posts found using expanded API strategy with user search term "${userSearchTerm || 'not provided'}" and app keywords from "${appName || 'not provided'}"`,
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