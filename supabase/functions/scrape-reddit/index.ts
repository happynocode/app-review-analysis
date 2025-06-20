import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Reddit API configuration (if you have API credentials)
// const REDDIT_API_KEY = Deno.env.get('REDDIT_API_KEY') // Your Reddit API key
// const REDDIT_CLIENT_ID = Deno.env.get('REDDIT_CLIENT_ID') // Your Reddit app client ID
// const REDDIT_CLIENT_SECRET = Deno.env.get('REDDIT_CLIENT_SECRET') // Your Reddit app secret

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
}

class EnhancedRedditScraper {
  private rateLimitDelay = 2000 // 2 seconds between requests
  private userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  ]

  private getRandomUserAgent(): string {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)]
  }

  private async delay(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms))
  }

  // Generate comprehensive search terms based on the app name
  private generateSearchTerms(appName: string): string[] {
    const cleanName = appName.trim()
    const nameWords = cleanName.split(/\s+/)
    const firstWord = nameWords[0]
    const lastWord = nameWords[nameWords.length - 1]
    
    const searchTerms = [
      // Exact app name variations
      cleanName,
      cleanName.toLowerCase(),
      cleanName.replace(/\s+/g, ''),
      
      // App-specific terms
      `${cleanName} app`,
      `${cleanName} application`,
      `${cleanName} mobile app`,
      
      // Review and feedback terms
      `${cleanName} review`,
      `${cleanName} reviews`,
      `${cleanName} feedback`,
      `${cleanName} experience`,
      
      // Problem and issue terms
      `${cleanName} problems`,
      `${cleanName} issues`,
      `${cleanName} bugs`,
      `${cleanName} not working`,
      
      // Comparison and alternative terms
      `${cleanName} vs`,
      `${cleanName} alternative`,
      `${cleanName} competitor`,
      
      // Single word searches (if multi-word app name)
      ...(nameWords.length > 1 ? [firstWord, lastWord] : []),
      
      // Quoted exact matches
      `"${cleanName}"`,
      `"${cleanName} app"`,
      
      // Common variations
      cleanName.replace(/[^a-zA-Z0-9\s]/g, ''), // Remove special characters
      cleanName.replace(/\s+/g, '_'), // Underscore version
    ]

    // Remove duplicates and empty strings
    return [...new Set(searchTerms.filter(term => term.length > 2))]
  }

  // Enhanced subreddit list with more comprehensive coverage
  private getTargetSubreddits(): string[] {
    return [
      // General app discussion
      'apps', 'androidapps', 'iosapps', 'AppReviews', 'software',
      
      // Platform-specific
      'Android', 'iphone', 'ios', 'apple', 'google',
      
      // Tech and productivity
      'technology', 'productivity', 'startups', 'entrepreneur',
      
      // User experience and reviews
      'reviews', 'userexperience', 'UXDesign', 'mobiledev',
      
      // General discussion
      'AskReddit', 'NoStupidQuestions', 'tipofmytongue',
      
      // Specific categories (will be filtered by relevance)
      'gaming', 'fitness', 'finance', 'education', 'social',
      'photography', 'music', 'news', 'shopping', 'travel'
    ]
  }

  // Strategy 1: Enhanced JSON API scraping with multiple search terms
  async scrapeWithEnhancedJSONAPI(appName: string): Promise<RedditPost[]> {
    const posts: RedditPost[] = []
    const searchTerms = this.generateSearchTerms(appName)
    const subreddits = this.getTargetSubreddits()

    console.log(`🔍 Enhanced JSON API scraping for: ${appName}`)
    console.log(`📝 Generated ${searchTerms.length} search terms: ${searchTerms.slice(0, 5).join(', ')}...`)
    console.log(`🎯 Targeting ${subreddits.length} subreddits`)

    // 1. Search specific subreddits with multiple terms
    for (const subreddit of subreddits.slice(0, 15)) { // Limit to top 15 subreddits
      for (const searchTerm of searchTerms.slice(0, 8)) { // Limit to top 8 search terms
        try {
          const url = `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(searchTerm)}&restrict_sr=1&sort=relevance&limit=50&t=all`
          
          console.log(`🔍 Searching r/${subreddit} for "${searchTerm}"`)
          
          const response = await fetch(url, {
            headers: {
              'User-Agent': this.getRandomUserAgent(),
              'Accept': 'application/json',
              'Accept-Language': 'en-US,en;q=0.9',
              'Cache-Control': 'no-cache',
              'Pragma': 'no-cache'
            }
          })

          if (response.ok) {
            const data = await response.json()
            
            if (data?.data?.children) {
              const subredditPosts = this.parseRedditData(data.data.children, appName, searchTerm)
              posts.push(...subredditPosts)
              console.log(`✅ Found ${subredditPosts.length} relevant posts in r/${subreddit} for "${searchTerm}"`)
            }
          } else {
            console.log(`⚠️ Failed to search r/${subreddit} for "${searchTerm}": ${response.status}`)
          }

          await this.delay(this.rateLimitDelay)
        } catch (error) {
          console.error(`❌ Error searching r/${subreddit} for "${searchTerm}":`, error.message)
          continue
        }
      }
    }

    // 2. Global searches with top search terms
    for (const searchTerm of searchTerms.slice(0, 10)) { // Top 10 search terms for global search
      try {
        const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(searchTerm)}&sort=relevance&limit=100&t=all`
        
        console.log(`🌐 Global search for "${searchTerm}"`)
        
        const response = await fetch(url, {
          headers: {
            'User-Agent': this.getRandomUserAgent(),
            'Accept': 'application/json',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        })

        if (response.ok) {
          const data = await response.json()
          
          if (data?.data?.children) {
            const globalPosts = this.parseRedditData(data.data.children, appName, searchTerm)
            posts.push(...globalPosts)
            console.log(`✅ Found ${globalPosts.length} relevant posts in global search for "${searchTerm}"`)
          }
        } else {
          console.log(`⚠️ Failed global search for "${searchTerm}": ${response.status}`)
        }

        await this.delay(this.rateLimitDelay)
      } catch (error) {
        console.error(`❌ Error in global search for "${searchTerm}":`, error.message)
        continue
      }
    }

    console.log(`📊 Enhanced JSON API completed: ${posts.length} total posts found`)
    return posts
  }

  // Strategy 2: Enhanced Pushshift API with better search terms
  async scrapeWithEnhancedPushshift(appName: string): Promise<RedditPost[]> {
    const posts: RedditPost[] = []
    const searchTerms = this.generateSearchTerms(appName).slice(0, 6) // Top 6 terms for Pushshift

    console.log(`🕐 Enhanced Pushshift scraping for: ${appName}`)

    for (const searchTerm of searchTerms) {
      try {
        // Search last 60 days for more recent content
        const after = Math.floor((Date.now() - 60 * 24 * 60 * 60 * 1000) / 1000)
        const url = `https://api.pushshift.io/reddit/search/submission/?q=${encodeURIComponent(searchTerm)}&size=200&after=${after}&sort=desc&sort_type=score`
        
        console.log(`🔍 Pushshift search for "${searchTerm}"`)
        
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
            console.log(`✅ Found ${pushshiftPosts.length} relevant posts via Pushshift for "${searchTerm}"`)
          }
        } else {
          console.log(`⚠️ Pushshift search failed for "${searchTerm}": ${response.status}`)
        }

        await this.delay(1000) // Pushshift has more lenient rate limits
      } catch (error) {
        console.error(`❌ Pushshift error for "${searchTerm}":`, error.message)
        continue
      }
    }

    console.log(`📊 Enhanced Pushshift completed: ${posts.length} total posts found`)
    return posts
  }

  // Strategy 3: Enhanced RSS scraping with better filtering
  async scrapeWithEnhancedRSS(appName: string): Promise<RedditPost[]> {
    const posts: RedditPost[] = []
    const subreddits = ['apps', 'androidapps', 'iosapps', 'technology', 'software', 'reviews']

    console.log(`📡 Enhanced RSS scraping for: ${appName}`)

    for (const subreddit of subreddits) {
      try {
        const urls = [
          `https://www.reddit.com/r/${subreddit}/hot.rss?limit=200`,
          `https://www.reddit.com/r/${subreddit}/new.rss?limit=200`,
          `https://www.reddit.com/r/${subreddit}/top.rss?t=week&limit=100`
        ]

        for (const url of urls) {
          try {
            console.log(`📡 RSS scraping ${url}`)
            
            const response = await fetch(url, {
              headers: {
                'User-Agent': this.getRandomUserAgent()
              }
            })

            if (response.ok) {
              const rssText = await response.text()
              const rssPosts = this.parseRSSFeed(rssText, appName, subreddit)
              posts.push(...rssPosts)
              console.log(`✅ Found ${rssPosts.length} relevant posts via RSS from r/${subreddit}`)
            }

            await this.delay(1500)
          } catch (urlError) {
            console.error(`❌ RSS URL error for ${url}:`, urlError.message)
          }
        }
      } catch (error) {
        console.error(`❌ RSS error for r/${subreddit}:`, error.message)
        continue
      }
    }

    console.log(`📊 Enhanced RSS completed: ${posts.length} total posts found`)
    return posts
  }

  // Enhanced Reddit JSON data parsing with better relevance filtering
  private parseRedditData(children: any[], appName: string, searchTerm: string): RedditPost[] {
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

        // Enhanced relevance checking
        const relevanceScore = this.calculateRelevanceScore(
          { title: titleLower, text: selftextLower }, 
          appNameLower, 
          appNameWords
        )

        if (relevanceScore < 2) continue // Minimum relevance threshold

        // Filter out removed/deleted content
        if (title.includes('[removed]') || title.includes('[deleted]') ||
            selftext.includes('[removed]') || selftext.includes('[deleted]')) {
          continue
        }

        const content = selftext || title
        if (content.length < 30) continue // Minimum content length

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
        console.error('Error parsing Reddit post:', error)
        continue
      }
    }

    return posts
  }

  // Enhanced Pushshift data parsing
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

  // Enhanced RSS feed parsing
  private parseRSSFeed(rssText: string, appName: string, subreddit: string): RedditPost[] {
    const posts: RedditPost[] = []
    const appNameLower = appName.toLowerCase()
    const appNameWords = appNameLower.split(/\s+/)

    try {
      const itemRegex = /<item>(.*?)<\/item>/gs
      const items = rssText.match(itemRegex) || []

      for (const item of items) {
        const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)
        const linkMatch = item.match(/<link>(.*?)<\/link>/)
        const descMatch = item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/)
        const pubDateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/)

        if (titleMatch && linkMatch) {
          const title = titleMatch[1] || ''
          const description = descMatch?.[1] || ''
          
          const titleLower = title.toLowerCase()
          const descLower = description.toLowerCase()

          const relevanceScore = this.calculateRelevanceScore(
            { title: titleLower, text: descLower }, 
            appNameLower, 
            appNameWords
          )

          if (relevanceScore >= 2 && title.length > 20) {
            posts.push({
              text: description || title,
              title: title,
              score: 0,
              date: pubDateMatch ? new Date(pubDateMatch[1]).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
              subreddit: subreddit,
              url: linkMatch[1],
              author: 'RSS',
              searchTerm: appName,
              commentCount: 0
            })
          }
        }
      }
    } catch (error) {
      console.error('Error parsing RSS:', error)
    }

    return posts
  }

  // Enhanced relevance scoring algorithm
  private calculateRelevanceScore(post: { title: string; text: string }, appNameLower: string, appNameWords: string[]): number {
    let score = 0
    const { title, text } = post

    // Exact app name matches (highest priority)
    if (title.includes(appNameLower)) score += 10
    if (text.includes(appNameLower)) score += 8

    // Individual word matches
    for (const word of appNameWords) {
      if (word.length > 2) {
        if (title.includes(word)) score += 3
        if (text.includes(word)) score += 2
      }
    }

    // App-related keywords
    const appKeywords = ['app', 'application', 'mobile', 'download', 'install', 'update']
    for (const keyword of appKeywords) {
      if (title.includes(keyword) || text.includes(keyword)) score += 1
    }

    // Review and feedback keywords
    const reviewKeywords = ['review', 'feedback', 'experience', 'opinion', 'recommend', 'rating']
    for (const keyword of reviewKeywords) {
      if (title.includes(keyword) || text.includes(keyword)) score += 2
    }

    // Problem keywords (valuable for analysis)
    const problemKeywords = ['problem', 'issue', 'bug', 'error', 'crash', 'broken', 'not working']
    for (const keyword of problemKeywords) {
      if (title.includes(keyword) || text.includes(keyword)) score += 2
    }

    // Negative indicators (reduce score)
    const negativeKeywords = ['spam', 'advertisement', 'promotion', 'affiliate']
    for (const keyword of negativeKeywords) {
      if (title.includes(keyword) || text.includes(keyword)) score -= 5
    }

    return score
  }

  // Main scraping method with enhanced strategies
  async scrapeReddit(appName: string): Promise<RedditPost[]> {
    const allPosts: RedditPost[] = []
    
    console.log(`\n🚀 === ENHANCED REDDIT SCRAPER STARTED ===`)
    console.log(`📱 App Name: "${appName}"`)
    console.log(`🎯 Using user-provided app name for search optimization`)
    console.log(`⏰ Start Time: ${new Date().toISOString()}`)

    // Strategy 1: Enhanced JSON API (most important)
    try {
      console.log(`\n📊 === STRATEGY 1: ENHANCED JSON API ===`)
      const jsonPosts = await this.scrapeWithEnhancedJSONAPI(appName)
      allPosts.push(...jsonPosts)
      console.log(`✅ Enhanced JSON API strategy: ${jsonPosts.length} posts`)
    } catch (error) {
      console.error('❌ Enhanced JSON API strategy failed:', error)
    }

    // Strategy 2: Enhanced Pushshift (historical data)
    try {
      console.log(`\n🕐 === STRATEGY 2: ENHANCED PUSHSHIFT ===`)
      const pushshiftPosts = await this.scrapeWithEnhancedPushshift(appName)
      allPosts.push(...pushshiftPosts)
      console.log(`✅ Enhanced Pushshift strategy: ${pushshiftPosts.length} posts`)
    } catch (error) {
      console.error('❌ Enhanced Pushshift strategy failed:', error)
    }

    // Strategy 3: Enhanced RSS (backup)
    try {
      console.log(`\n📡 === STRATEGY 3: ENHANCED RSS ===`)
      const rssPosts = await this.scrapeWithEnhancedRSS(appName)
      allPosts.push(...rssPosts)
      console.log(`✅ Enhanced RSS strategy: ${rssPosts.length} posts`)
    } catch (error) {
      console.error('❌ Enhanced RSS strategy failed:', error)
    }

    // Enhanced deduplication and filtering
    console.log(`\n🔧 === ENHANCED POST PROCESSING ===`)
    const uniquePosts = this.enhancedDeduplicationAndFilter(allPosts, appName)
    
    console.log(`\n🎯 === ENHANCED REDDIT SCRAPING COMPLETED ===`)
    console.log(`📊 Total posts collected: ${allPosts.length}`)
    console.log(`✨ Final unique, relevant posts: ${uniquePosts.length}`)
    console.log(`⏰ End Time: ${new Date().toISOString()}`)
    
    return uniquePosts
  }

  // Enhanced deduplication and filtering
  private enhancedDeduplicationAndFilter(posts: RedditPost[], appName: string): RedditPost[] {
    console.log(`🔧 Enhanced deduplication and filtering: ${posts.length} input posts`)

    // Step 1: Remove exact duplicates by URL and content
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

    // Step 2: Enhanced filtering
    const appNameLower = appName.toLowerCase()
    const appNameWords = appNameLower.split(/\s+/)
    
    const filteredPosts = uniquePosts.filter(post => {
      const text = post.text.toLowerCase()
      const title = post.title.toLowerCase()
      
      // Quality filters
      if (post.text.length < 50 || post.text.length > 8000) return false
      if (post.score < -10) return false // Allow some negative scores but not too low
      
      // Content quality filters
      if (text.includes('[removed]') || text.includes('[deleted]')) return false
      if (text.includes('automod') || text.includes('this post has been removed')) return false
      if (title.includes('daily thread') || title.includes('weekly thread')) return false
      
      // Relevance filter (enhanced)
      const relevanceScore = this.calculateRelevanceScore({ title, text }, appNameLower, appNameWords)
      if (relevanceScore < 3) return false
      
      // Spam and low-quality content filters
      const spamIndicators = ['click here', 'buy now', 'limited time', 'act fast', 'make money']
      if (spamIndicators.some(indicator => text.includes(indicator))) return false
      
      return true
    })

    console.log(`📊 After enhanced filtering: ${filteredPosts.length} posts`)

    // Step 3: Enhanced ranking and selection
    const rankedPosts = filteredPosts
      .map(post => ({
        ...post,
        relevanceScore: this.calculateEnhancedRelevanceScore(post, appName)
      }))
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 50) // Top 50 most relevant posts

    console.log(`✅ Enhanced processing completed: ${rankedPosts.length} final posts`)
    
    return rankedPosts
  }

  // Enhanced relevance scoring for final ranking
  private calculateEnhancedRelevanceScore(post: RedditPost, appName: string): number {
    const appNameLower = appName.toLowerCase()
    const text = post.text.toLowerCase()
    const title = post.title.toLowerCase()
    
    let score = 0
    
    // Base Reddit metrics
    score += Math.min(post.score * 0.1, 20) // Reddit score (capped)
    score += Math.min((post.commentCount || 0) * 0.2, 10) // Comment engagement
    score += post.text.length / 100 // Content length
    
    // Relevance factors
    if (title.includes(appNameLower)) score += 15
    if (text.includes(appNameLower)) score += 10
    
    // App-specific terms
    const appTerms = [`${appNameLower} app`, `${appNameLower} application`]
    for (const term of appTerms) {
      if (title.includes(term) || text.includes(term)) score += 8
    }
    
    // Review indicators
    const reviewTerms = ['review', 'experience', 'opinion', 'recommend', 'rating', 'feedback']
    for (const term of reviewTerms) {
      if (title.includes(term)) score += 5
      if (text.includes(term)) score += 3
    }
    
    // Problem/issue indicators (valuable for analysis)
    const problemTerms = ['problem', 'issue', 'bug', 'error', 'crash', 'broken', 'not working', 'disappointed']
    for (const term of problemTerms) {
      if (title.includes(term)) score += 4
      if (text.includes(term)) score += 2
    }
    
    // Quality indicators
    if (post.upvoteRatio && post.upvoteRatio > 0.7) score += 5
    if (post.text.length > 300) score += 3
    if (post.author !== 'Anonymous' && post.author !== 'RSS') score += 2
    
    // Subreddit relevance
    const relevantSubreddits = ['apps', 'androidapps', 'iosapps', 'reviews', 'software']
    if (relevantSubreddits.includes(post.subreddit.toLowerCase())) score += 5
    
    // Recency bonus (more recent posts are more valuable)
    const postDate = new Date(post.date)
    const daysSincePost = (Date.now() - postDate.getTime()) / (1000 * 60 * 60 * 24)
    if (daysSincePost < 30) score += 3
    else if (daysSincePost < 90) score += 1
    
    return score
  }
}

// Main handler
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

    console.log(`🚀 Enhanced Reddit scraping request for: "${appName}"`)
    console.log(`🎯 Using user-provided app name for optimized search`)

    const scraper = new EnhancedRedditScraper()
    const posts = await scraper.scrapeReddit(appName)

    // Save to database if session ID provided
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
          rating: null, // Reddit posts don't have ratings
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
            relevance_score: (post as any).relevanceScore || 0,
            scraper_version: 'enhanced_v3.0'
          }
        }))

        // Save in batches to avoid timeouts
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

    // Calculate enhanced statistics
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
      ).sort(([,a], [,b]) => b - a).slice(0, 5)
    }

    console.log(`\n📊 === ENHANCED REDDIT SCRAPING STATISTICS ===`)
    console.log(`✅ Total posts: ${stats.totalPosts}`)
    console.log(`🎯 Average relevance score: ${stats.averageRelevanceScore}`)
    console.log(`📈 Average Reddit score: ${stats.averageScore}`)
    console.log(`🏷️ Subreddits found: ${stats.subreddits.length}`)
    console.log(`🔍 Search terms used: ${stats.searchTermsUsed.length}`)

    return new Response(
      JSON.stringify({ 
        posts,
        stats,
        message: `Enhanced Reddit scraping completed: ${posts.length} high-quality, relevant posts found using optimized search terms based on "${appName}"`,
        timestamp: new Date().toISOString(),
        scraper_version: 'enhanced_v3.0',
        search_optimization: 'user_provided_app_name'
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
          scraper_version: 'enhanced_v3.0'
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