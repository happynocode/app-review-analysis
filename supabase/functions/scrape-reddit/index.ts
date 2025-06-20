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
  appName: string
  scrapingSessionId?: string
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
  private rateLimitDelay = 1000 // 1 second between requests (Reddit allows 60 requests per minute)

  constructor() {
    if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET) {
      console.warn('⚠️ Reddit API credentials not configured. Using fallback methods.')
    }
  }

  private async delay(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms))
  }

  // 🔐 获取 Reddit API 访问令牌
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

  // 🔍 使用 Reddit API 搜索
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
        t: 'all',
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

  // 🔍 获取特定 subreddit 的热门帖子
  async getSubredditPosts(subreddit: string, sort: 'hot' | 'new' | 'top' = 'hot', limit: number = 100): Promise<RedditPost[]> {
    const token = await this.getAccessToken()
    if (!token) {
      return []
    }

    try {
      const url = `https://oauth.reddit.com/r/${subreddit}/${sort}?limit=${limit}`
      
      console.log(`📡 Fetching r/${subreddit}/${sort} (limit: ${limit})`)
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'User-Agent': REDDIT_USER_AGENT
        }
      })

      if (!response.ok) {
        throw new Error(`Subreddit fetch failed: ${response.status}`)
      }

      const data = await response.json()
      
      if (data?.data?.children) {
        const posts = this.parseRedditAPIData(data.data.children, subreddit)
        console.log(`✅ Fetched ${posts.length} posts from r/${subreddit}`)
        return posts
      }

      return []

    } catch (error) {
      console.error(`❌ Error fetching r/${subreddit}:`, error.message)
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

class EnhancedRedditScraper {
  private apiClient: RedditAPIClient
  private rateLimitDelay = 2000 // 2 seconds between non-API requests
  private userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  ]

  constructor() {
    this.apiClient = new RedditAPIClient()
  }

  private getRandomUserAgent(): string {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)]
  }

  private async delay(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms))
  }

  // 生成搜索关键词（基于用户提供的应用名称）
  private generateSearchTerms(appName: string): string[] {
    const cleanName = appName.trim()
    const nameWords = cleanName.split(/\s+/)
    
    const searchTerms = [
      // 精确匹配
      cleanName,
      `"${cleanName}"`,
      
      // 应用相关
      `${cleanName} app`,
      `${cleanName} application`,
      `${cleanName} mobile`,
      
      // 评价相关
      `${cleanName} review`,
      `${cleanName} reviews`,
      `${cleanName} feedback`,
      `${cleanName} experience`,
      `${cleanName} opinion`,
      
      // 问题相关
      `${cleanName} problem`,
      `${cleanName} issue`,
      `${cleanName} bug`,
      `${cleanName} not working`,
      `${cleanName} crash`,
      
      // 比较相关
      `${cleanName} vs`,
      `${cleanName} alternative`,
      `${cleanName} better than`,
      
      // 如果是多词应用名，也搜索单个词
      ...(nameWords.length > 1 ? nameWords.filter(word => word.length > 3) : [])
    ]

    // 去重并过滤
    return [...new Set(searchTerms.filter(term => term.length > 2))]
  }

  // 获取目标 subreddits
  private getTargetSubreddits(): string[] {
    return [
      // 应用相关
      'apps', 'androidapps', 'iosapps', 'AppReviews', 'software',
      
      // 平台相关
      'Android', 'iphone', 'ios', 'apple', 'google', 'GooglePlay',
      
      // 技术相关
      'technology', 'tech', 'gadgets', 'productivity', 'startups',
      
      // 用户体验
      'userexperience', 'UXDesign', 'mobiledev', 'webdev',
      
      // 一般讨论
      'AskReddit', 'NoStupidQuestions', 'tipofmytongue', 'HelpMeFind',
      
      // 特定类别
      'gaming', 'fitness', 'finance', 'education', 'social',
      'photography', 'music', 'news', 'shopping', 'travel',
      'business', 'entrepreneur', 'smallbusiness'
    ]
  }

  // 🚀 主要搜索方法：优先使用 Reddit API
  async scrapeReddit(appName: string): Promise<RedditPost[]> {
    const allPosts: RedditPost[] = []
    
    console.log(`\n🚀 === ENHANCED REDDIT SCRAPER WITH API ===`)
    console.log(`📱 App Name: "${appName}"`)
    console.log(`🔑 Reddit API: ${REDDIT_CLIENT_ID ? 'Configured' : 'Not configured'}`)
    console.log(`🎯 Using user-provided app name for optimized search`)
    console.log(`⏰ Start Time: ${new Date().toISOString()}`)

    const searchTerms = this.generateSearchTerms(appName)
    const subreddits = this.getTargetSubreddits()

    console.log(`📝 Generated ${searchTerms.length} search terms`)
    console.log(`🎯 Targeting ${subreddits.length} subreddits`)

    // 策略1: Reddit API 搜索（如果可用）
    if (REDDIT_CLIENT_ID && REDDIT_CLIENT_SECRET) {
      console.log(`\n🔑 === STRATEGY 1: REDDIT API SEARCH ===`)
      
      try {
        // 全站搜索最相关的关键词
        for (const term of searchTerms.slice(0, 5)) {
          const apiPosts = await this.apiClient.searchWithAPI(term, undefined, 100)
          allPosts.push(...apiPosts)
          console.log(`🔍 API global search "${term}": ${apiPosts.length} posts`)
          await this.delay(1000) // API rate limiting
        }

        // 特定 subreddit 搜索
        for (const subreddit of subreddits.slice(0, 10)) {
          for (const term of searchTerms.slice(0, 3)) {
            const subredditPosts = await this.apiClient.searchWithAPI(term, subreddit, 50)
            allPosts.push(...subredditPosts)
            console.log(`🔍 API r/${subreddit} search "${term}": ${subredditPosts.length} posts`)
            await this.delay(1000) // API rate limiting
          }
        }

        // 获取相关 subreddit 的热门帖子
        for (const subreddit of ['apps', 'androidapps', 'iosapps', 'software'].slice(0, 4)) {
          const hotPosts = await this.apiClient.getSubredditPosts(subreddit, 'hot', 100)
          const relevantPosts = this.filterRelevantPosts(hotPosts, appName)
          allPosts.push(...relevantPosts)
          console.log(`📡 API r/${subreddit}/hot: ${relevantPosts.length} relevant posts`)
          await this.delay(1000)
        }

        console.log(`✅ Reddit API strategy completed: ${allPosts.length} posts collected`)

      } catch (error) {
        console.error('❌ Reddit API strategy failed:', error.message)
      }
    }

    // 策略2: JSON API 备用方法（如果 API 不可用或需要更多数据）
    console.log(`\n📊 === STRATEGY 2: JSON API FALLBACK ===`)
    
    try {
      const jsonPosts = await this.scrapeWithJSONAPI(appName, searchTerms, subreddits)
      allPosts.push(...jsonPosts)
      console.log(`✅ JSON API fallback: ${jsonPosts.length} additional posts`)
    } catch (error) {
      console.error('❌ JSON API fallback failed:', error.message)
    }

    // 策略3: Pushshift 历史数据
    console.log(`\n🕐 === STRATEGY 3: PUSHSHIFT HISTORICAL DATA ===`)
    
    try {
      const pushshiftPosts = await this.scrapeWithPushshift(appName, searchTerms)
      allPosts.push(...pushshiftPosts)
      console.log(`✅ Pushshift strategy: ${pushshiftPosts.length} historical posts`)
    } catch (error) {
      console.error('❌ Pushshift strategy failed:', error.message)
    }

    // 最终处理
    console.log(`\n🔧 === FINAL PROCESSING ===`)
    const uniquePosts = this.enhancedDeduplicationAndFilter(allPosts, appName)
    
    console.log(`\n🎯 === REDDIT SCRAPING COMPLETED ===`)
    console.log(`📊 Total posts collected: ${allPosts.length}`)
    console.log(`✨ Final unique, relevant posts: ${uniquePosts.length}`)
    console.log(`🔑 API usage: ${REDDIT_CLIENT_ID ? 'Enabled' : 'Disabled'}`)
    console.log(`⏰ End Time: ${new Date().toISOString()}`)
    
    return uniquePosts
  }

  // 过滤相关帖子
  private filterRelevantPosts(posts: RedditPost[], appName: string): RedditPost[] {
    const appNameLower = appName.toLowerCase()
    const appNameWords = appNameLower.split(/\s+/)

    return posts.filter(post => {
      const title = post.title.toLowerCase()
      const text = post.text.toLowerCase()
      
      // 检查相关性
      const relevanceScore = this.calculateRelevanceScore(
        { title, text }, 
        appNameLower, 
        appNameWords
      )
      
      return relevanceScore >= 3 // 最低相关性阈值
    })
  }

  // JSON API 备用方法
  private async scrapeWithJSONAPI(appName: string, searchTerms: string[], subreddits: string[]): Promise<RedditPost[]> {
    const posts: RedditPost[] = []

    // 限制搜索范围以避免过多请求
    for (const subreddit of subreddits.slice(0, 8)) {
      for (const searchTerm of searchTerms.slice(0, 3)) {
        try {
          const url = `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(searchTerm)}&restrict_sr=1&sort=relevance&limit=25&t=all`
          
          const response = await fetch(url, {
            headers: {
              'User-Agent': this.getRandomUserAgent(),
              'Accept': 'application/json'
            }
          })

          if (response.ok) {
            const data = await response.json()
            if (data?.data?.children) {
              const subredditPosts = this.parseJSONData(data.data.children, appName, searchTerm)
              posts.push(...subredditPosts)
            }
          }

          await this.delay(this.rateLimitDelay)
        } catch (error) {
          console.error(`JSON API error for r/${subreddit}:`, error.message)
        }
      }
    }

    return posts
  }

  // Pushshift 历史数据
  private async scrapeWithPushshift(appName: string, searchTerms: string[]): Promise<RedditPost[]> {
    const posts: RedditPost[] = []

    for (const searchTerm of searchTerms.slice(0, 4)) {
      try {
        const after = Math.floor((Date.now() - 90 * 24 * 60 * 60 * 1000) / 1000) // 90天前
        const url = `https://api.pushshift.io/reddit/search/submission/?q=${encodeURIComponent(searchTerm)}&size=100&after=${after}&sort=desc&sort_type=score`
        
        const response = await fetch(url, {
          headers: {
            'User-Agent': this.getRandomUserAgent()
          }
        })

        if (response.ok) {
          const data = await response.json()
          if (data?.data && Array.isArray(data.data)) {
            const pushshiftPosts = this.parsePushshiftData(data.data, appName, searchTerm)
            posts.push(...pushshiftPosts)
          }
        }

        await this.delay(1000)
      } catch (error) {
        console.error(`Pushshift error for "${searchTerm}":`, error.message)
      }
    }

    return posts
  }

  // 解析 JSON 数据
  private parseJSONData(children: any[], appName: string, searchTerm: string): RedditPost[] {
    const posts: RedditPost[] = []
    const appNameLower = appName.toLowerCase()
    const appNameWords = appNameLower.split(/\s+/)

    for (const child of children) {
      try {
        const post = child.data
        if (!post) continue

        const title = post.title || ''
        const selftext = post.selftext || ''
        const titleLower = title.toLowerCase()
        const selftextLower = selftext.toLowerCase()

        const relevanceScore = this.calculateRelevanceScore(
          { title: titleLower, text: selftextLower }, 
          appNameLower, 
          appNameWords
        )

        if (relevanceScore < 2) continue

        const content = selftext || title
        if (content.length < 30) continue

        posts.push({
          text: content,
          title: title,
          score: post.score || 0,
          date: new Date(post.created_utc * 1000).toISOString().split('T')[0],
          subreddit: post.subreddit || 'unknown',
          url: post.permalink ? `https://reddit.com${post.permalink}` : '',
          author: post.author || 'Anonymous',
          searchTerm: searchTerm,
          upvoteRatio: post.upvote_ratio || 0,
          commentCount: post.num_comments || 0,
          postId: post.id || ''
        })
      } catch (error) {
        console.error('Error parsing JSON post:', error)
        continue
      }
    }

    return posts
  }

  // 解析 Pushshift 数据
  private parsePushshiftData(data: any[], appName: string, searchTerm: string): RedditPost[] {
    const posts: RedditPost[] = []
    const appNameLower = appName.toLowerCase()
    const appNameWords = appNameLower.split(/\s+/)

    for (const post of data) {
      try {
        const title = post.title || ''
        const selftext = post.selftext || ''
        const titleLower = title.toLowerCase()
        const selftextLower = selftext.toLowerCase()

        const relevanceScore = this.calculateRelevanceScore(
          { title: titleLower, text: selftextLower }, 
          appNameLower, 
          appNameWords
        )

        if (relevanceScore < 2) continue

        const content = selftext || title
        if (content.length < 30) continue

        posts.push({
          text: content,
          title: title,
          score: post.score || 0,
          date: new Date(post.created_utc * 1000).toISOString().split('T')[0],
          subreddit: post.subreddit || 'unknown',
          url: `https://reddit.com/r/${post.subreddit}/comments/${post.id}`,
          author: post.author || 'Anonymous',
          searchTerm: searchTerm,
          upvoteRatio: 0,
          commentCount: post.num_comments || 0,
          postId: post.id || ''
        })
      } catch (error) {
        console.error('Error parsing Pushshift post:', error)
        continue
      }
    }

    return posts
  }

  // 相关性评分算法
  private calculateRelevanceScore(post: { title: string; text: string }, appNameLower: string, appNameWords: string[]): number {
    let score = 0
    const { title, text } = post

    // 精确匹配应用名称
    if (title.includes(appNameLower)) score += 15
    if (text.includes(appNameLower)) score += 10

    // 单词匹配
    for (const word of appNameWords) {
      if (word.length > 2) {
        if (title.includes(word)) score += 5
        if (text.includes(word)) score += 3
      }
    }

    // 应用相关关键词
    const appKeywords = ['app', 'application', 'mobile', 'download', 'install', 'update', 'version']
    for (const keyword of appKeywords) {
      if (title.includes(keyword) || text.includes(keyword)) score += 2
    }

    // 评价关键词
    const reviewKeywords = ['review', 'feedback', 'experience', 'opinion', 'recommend', 'rating', 'thoughts']
    for (const keyword of reviewKeywords) {
      if (title.includes(keyword) || text.includes(keyword)) score += 3
    }

    // 问题关键词
    const problemKeywords = ['problem', 'issue', 'bug', 'error', 'crash', 'broken', 'not working', 'help']
    for (const keyword of problemKeywords) {
      if (title.includes(keyword) || text.includes(keyword)) score += 3
    }

    // 负面指标
    const negativeKeywords = ['spam', 'advertisement', 'promotion', 'affiliate', 'referral']
    for (const keyword of negativeKeywords) {
      if (title.includes(keyword) || text.includes(keyword)) score -= 10
    }

    return score
  }

  // 增强的去重和过滤
  private enhancedDeduplicationAndFilter(posts: RedditPost[], appName: string): RedditPost[] {
    console.log(`🔧 Enhanced deduplication and filtering: ${posts.length} input posts`)

    // 去重
    const seenUrls = new Set<string>()
    const seenContent = new Set<string>()
    const uniquePosts = posts.filter(post => {
      const urlKey = post.url || `${post.title}_${post.author}_${post.date}`
      const contentKey = post.text.substring(0, 200).toLowerCase().replace(/\s+/g, ' ')
      
      if (seenUrls.has(urlKey) || seenContent.has(contentKey)) {
        return false
      }
      
      seenUrls.add(urlKey)
      seenContent.add(contentKey)
      return true
    })

    console.log(`📊 After deduplication: ${uniquePosts.length} posts`)

    // 过滤
    const appNameLower = appName.toLowerCase()
    const appNameWords = appNameLower.split(/\s+/)
    
    const filteredPosts = uniquePosts.filter(post => {
      const text = post.text.toLowerCase()
      const title = post.title.toLowerCase()
      
      // 质量过滤
      if (post.text.length < 50 || post.text.length > 8000) return false
      if (post.score < -10) return false
      
      // 内容质量过滤
      if (text.includes('[removed]') || text.includes('[deleted]')) return false
      if (text.includes('automod') || text.includes('this post has been removed')) return false
      if (title.includes('daily thread') || title.includes('weekly thread')) return false
      if (post.isStickied) return false // 过滤置顶帖
      
      // 相关性过滤
      const relevanceScore = this.calculateRelevanceScore({ title, text }, appNameLower, appNameWords)
      if (relevanceScore < 4) return false
      
      // 垃圾内容过滤
      const spamIndicators = ['click here', 'buy now', 'limited time', 'act fast', 'make money', 'get rich']
      if (spamIndicators.some(indicator => text.includes(indicator))) return false
      
      return true
    })

    console.log(`📊 After enhanced filtering: ${filteredPosts.length} posts`)

    // 最终排序和选择
    const rankedPosts = filteredPosts
      .map(post => ({
        ...post,
        relevanceScore: this.calculateEnhancedRelevanceScore(post, appName)
      }))
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 50) // 前50个最相关的帖子

    console.log(`✅ Enhanced processing completed: ${rankedPosts.length} final posts`)
    
    return rankedPosts
  }

  // 增强的相关性评分
  private calculateEnhancedRelevanceScore(post: RedditPost, appName: string): number {
    const appNameLower = appName.toLowerCase()
    const text = post.text.toLowerCase()
    const title = post.title.toLowerCase()
    
    let score = 0
    
    // Reddit 指标
    score += Math.min(post.score * 0.1, 20)
    score += Math.min((post.commentCount || 0) * 0.2, 15)
    score += (post.gilded || 0) * 5 // 获得金币的帖子通常质量更高
    score += post.text.length / 100
    
    // 相关性因素
    if (title.includes(appNameLower)) score += 20
    if (text.includes(appNameLower)) score += 15
    
    // 应用特定术语
    const appTerms = [`${appNameLower} app`, `${appNameLower} application`]
    for (const term of appTerms) {
      if (title.includes(term) || text.includes(term)) score += 10
    }
    
    // 评价指标
    const reviewTerms = ['review', 'experience', 'opinion', 'recommend', 'rating', 'feedback', 'thoughts']
    for (const term of reviewTerms) {
      if (title.includes(term)) score += 6
      if (text.includes(term)) score += 4
    }
    
    // 问题指标
    const problemTerms = ['problem', 'issue', 'bug', 'error', 'crash', 'broken', 'not working', 'disappointed', 'frustrated']
    for (const term of problemTerms) {
      if (title.includes(term)) score += 5
      if (text.includes(term)) score += 3
    }
    
    // 质量指标
    if (post.upvoteRatio && post.upvoteRatio > 0.8) score += 8
    if (post.text.length > 300) score += 5
    if (post.author !== 'Anonymous' && post.author !== 'RSS') score += 3
    
    // Subreddit 相关性
    const relevantSubreddits = ['apps', 'androidapps', 'iosapps', 'reviews', 'software', 'technology']
    if (relevantSubreddits.includes(post.subreddit.toLowerCase())) score += 8
    
    // 时效性加分
    const postDate = new Date(post.date)
    const daysSincePost = (Date.now() - postDate.getTime()) / (1000 * 60 * 60 * 24)
    if (daysSincePost < 30) score += 5
    else if (daysSincePost < 90) score += 2
    
    return score
  }
}

// 主处理函数
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { appName, scrapingSessionId }: ScrapeRequest = await req.json()

    if (!appName) {
      return new Response(
        JSON.stringify({ error: 'Missing appName parameter' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    console.log(`🚀 Enhanced Reddit scraping with API for: "${appName}"`)
    console.log(`🔑 Reddit API status: ${REDDIT_CLIENT_ID ? 'Configured' : 'Not configured'}`)

    const scraper = new EnhancedRedditScraper()
    const posts = await scraper.scrapeReddit(appName)

    // 保存到数据库
    if (scrapingSessionId && posts.length > 0) {
      try {
        console.log(`💾 Saving ${posts.length} posts to database...`)
        
        const supabaseClient = createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

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
            relevance_score: (post as any).relevanceScore || 0,
            scraper_version: 'api_enhanced_v4.0',
            api_used: REDDIT_CLIENT_ID ? true : false
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

      } catch (saveError) {
        console.error('❌ Error saving Reddit posts to database:', saveError)
      }
    }

    // 计算统计信息
    const stats = {
      totalPosts: posts.length,
      subreddits: [...new Set(posts.map(p => p.subreddit))],
      averageScore: posts.length > 0 ? Math.round(posts.reduce((sum, p) => sum + p.score, 0) / posts.length) : 0,
      averageRelevanceScore: posts.length > 0 ? Math.round(posts.reduce((sum, p) => sum + ((p as any).relevanceScore || 0), 0) / posts.length) : 0,
      dateRange: posts.length > 0 ? {
        earliest: Math.min(...posts.map(p => new Date(p.date).getTime())),
        latest: Math.max(...posts.map(p => new Date(p.date).getTime()))
      } : null,
      searchTermsUsed: posts.length > 0 ? [...new Set(posts.map(p => p.searchTerm).filter(Boolean))] : [],
      topSubreddits: Object.entries(
        posts.reduce((acc, p) => {
          acc[p.subreddit] = (acc[p.subreddit] || 0) + 1
          return acc
        }, {} as Record<string, number>)
      ).sort(([,a], [,b]) => b - a).slice(0, 5),
      apiUsed: REDDIT_CLIENT_ID ? true : false,
      gildedPosts: posts.filter(p => (p.gilded || 0) > 0).length
    }

    console.log(`\n📊 === ENHANCED REDDIT SCRAPING STATISTICS ===`)
    console.log(`✅ Total posts: ${stats.totalPosts}`)
    console.log(`🎯 Average relevance score: ${stats.averageRelevanceScore}`)
    console.log(`📈 Average Reddit score: ${stats.averageScore}`)
    console.log(`🏷️ Subreddits found: ${stats.subreddits.length}`)
    console.log(`🔍 Search terms used: ${stats.searchTermsUsed.length}`)
    console.log(`🔑 Reddit API used: ${stats.apiUsed}`)
    console.log(`🏆 Gilded posts: ${stats.gildedPosts}`)

    return new Response(
      JSON.stringify({ 
        posts,
        stats,
        message: `Enhanced Reddit scraping completed: ${posts.length} high-quality, relevant posts found using ${stats.apiUsed ? 'Reddit API + fallback methods' : 'fallback methods only'} based on "${appName}"`,
        timestamp: new Date().toISOString(),
        scraper_version: 'api_enhanced_v4.0',
        search_optimization: 'user_provided_app_name',
        api_integration: {
          reddit_api_used: stats.apiUsed,
          client_id_configured: REDDIT_CLIENT_ID ? true : false,
          user_agent: REDDIT_USER_AGENT
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('❌ Critical error in Enhanced Reddit scraping:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Failed to scrape Reddit',
        details: error.message,
        posts: [],
        stats: {
          totalPosts: 0,
          errorCount: 1,
          scraper_version: 'api_enhanced_v4.0',
          api_integration: {
            reddit_api_used: false,
            client_id_configured: REDDIT_CLIENT_ID ? true : false,
            error: error.message
          }
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