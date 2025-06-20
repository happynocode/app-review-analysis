import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

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
}

class RedditScraper {
  private rateLimitDelay = 2000 // 2秒延迟
  private userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  ]

  private getRandomUserAgent(): string {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)]
  }

  private async delay(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms))
  }

  // 策略1: 使用 Reddit JSON API (最可靠)
  async scrapeWithJSONAPI(appName: string): Promise<RedditPost[]> {
    const posts: RedditPost[] = []
    const searchTerms = [appName, `${appName} app`, `${appName} review`]
    const subreddits = ['apps', 'androidapps', 'iosapps', 'AppReviews', 'software']

    console.log(`Starting JSON API scraping for: ${appName}`)

    // 1. 搜索特定 subreddits
    for (const subreddit of subreddits) {
      for (const searchTerm of searchTerms) {
        try {
          const url = `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(searchTerm)}&restrict_sr=1&sort=relevance&limit=25&t=all`
          
          console.log(`Searching r/${subreddit} for "${searchTerm}"`)
          
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
              console.log(`Found ${subredditPosts.length} posts in r/${subreddit}`)
            }
          } else {
            console.log(`Failed to search r/${subreddit}: ${response.status}`)
          }

          await this.delay(this.rateLimitDelay)
        } catch (error) {
          console.error(`Error searching r/${subreddit}:`, error.message)
          continue
        }
      }
    }

    // 2. 全站搜索
    for (const searchTerm of searchTerms) {
      try {
        const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(searchTerm)}&sort=relevance&limit=50&t=all`
        
        console.log(`Global search for "${searchTerm}"`)
        
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
            console.log(`Found ${globalPosts.length} posts in global search`)
          }
        } else {
          console.log(`Failed global search: ${response.status}`)
        }

        await this.delay(this.rateLimitDelay)
      } catch (error) {
        console.error(`Error in global search:`, error.message)
        continue
      }
    }

    return posts
  }

  // 策略2: 使用 Pushshift API (历史数据)
  async scrapeWithPushshift(appName: string): Promise<RedditPost[]> {
    const posts: RedditPost[] = []
    const searchTerms = [appName, `${appName} app`]

    console.log(`Starting Pushshift scraping for: ${appName}`)

    for (const searchTerm of searchTerms) {
      try {
        // Pushshift 搜索最近30天的数据
        const after = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000) // 30天前
        const url = `https://api.pushshift.io/reddit/search/submission/?q=${encodeURIComponent(searchTerm)}&size=100&after=${after}&sort=desc&sort_type=score`
        
        console.log(`Pushshift search for "${searchTerm}"`)
        
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
            console.log(`Found ${pushshiftPosts.length} posts via Pushshift`)
          }
        } else {
          console.log(`Pushshift search failed: ${response.status}`)
        }

        await this.delay(1000) // Pushshift 限制较宽松
      } catch (error) {
        console.error(`Pushshift error:`, error.message)
        continue
      }
    }

    return posts
  }

  // 策略3: 使用 Reddit RSS (备用方案)
  async scrapeWithRSS(appName: string): Promise<RedditPost[]> {
    const posts: RedditPost[] = []
    const subreddits = ['apps', 'androidapps', 'iosapps']

    console.log(`Starting RSS scraping for: ${appName}`)

    for (const subreddit of subreddits) {
      try {
        const url = `https://www.reddit.com/r/${subreddit}/hot.rss?limit=100`
        
        console.log(`RSS scraping r/${subreddit}`)
        
        const response = await fetch(url, {
          headers: {
            'User-Agent': this.getRandomUserAgent()
          }
        })

        if (response.ok) {
          const rssText = await response.text()
          const rssPosts = this.parseRSSFeed(rssText, appName, subreddit)
          posts.push(...rssPosts)
          console.log(`Found ${rssPosts.length} relevant posts via RSS`)
        } else {
          console.log(`RSS scraping failed for r/${subreddit}: ${response.status}`)
        }

        await this.delay(1500)
      } catch (error) {
        console.error(`RSS error for r/${subreddit}:`, error.message)
        continue
      }
    }

    return posts
  }

  // 解析 Reddit JSON API 数据
  private parseRedditData(children: any[], appName: string, searchTerm: string): RedditPost[] {
    const posts: RedditPost[] = []
    const appNameLower = appName.toLowerCase()

    for (const child of children) {
      try {
        const post = child.data
        if (!post) continue

        const title = post.title || ''
        const selftext = post.selftext || ''
        const titleLower = title.toLowerCase()
        const selftextLower = selftext.toLowerCase()

        // 检查相关性
        const isRelevant = titleLower.includes(appNameLower) || 
                          selftextLower.includes(appNameLower) ||
                          titleLower.includes(appNameLower.replace(/\s+/g, ''))

        if (!isRelevant) continue

        // 过滤掉删除的内容
        if (title.includes('[removed]') || title.includes('[deleted]') ||
            selftext.includes('[removed]') || selftext.includes('[deleted]')) {
          continue
        }

        const content = selftext || title
        if (content.length < 20) continue

        posts.push({
          text: content,
          title: title,
          score: post.score || 0,
          date: new Date(post.created_utc * 1000).toISOString().split('T')[0],
          subreddit: post.subreddit || 'unknown',
          url: post.permalink ? `https://reddit.com${post.permalink}` : '',
          author: post.author || 'Anonymous',
          searchTerm: searchTerm,
          upvoteRatio: post.upvote_ratio || 0
        })
      } catch (error) {
        console.error('Error parsing Reddit post:', error)
        continue
      }
    }

    return posts
  }

  // 解析 Pushshift 数据
  private parsePushshiftData(data: any[], appName: string, searchTerm: string): RedditPost[] {
    const posts: RedditPost[] = []
    const appNameLower = appName.toLowerCase()

    for (const post of data) {
      try {
        const title = post.title || ''
        const selftext = post.selftext || ''
        const titleLower = title.toLowerCase()
        const selftextLower = selftext.toLowerCase()

        const isRelevant = titleLower.includes(appNameLower) || 
                          selftextLower.includes(appNameLower)

        if (!isRelevant) continue

        const content = selftext || title
        if (content.length < 20) continue

        posts.push({
          text: content,
          title: title,
          score: post.score || 0,
          date: new Date(post.created_utc * 1000).toISOString().split('T')[0],
          subreddit: post.subreddit || 'unknown',
          url: `https://reddit.com/r/${post.subreddit}/comments/${post.id}`,
          author: post.author || 'Anonymous',
          searchTerm: searchTerm,
          upvoteRatio: 0
        })
      } catch (error) {
        console.error('Error parsing Pushshift post:', error)
        continue
      }
    }

    return posts
  }

  // 解析 RSS Feed
  private parseRSSFeed(rssText: string, appName: string, subreddit: string): RedditPost[] {
    const posts: RedditPost[] = []
    const appNameLower = appName.toLowerCase()

    try {
      // 简单的RSS解析
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

          const isRelevant = titleLower.includes(appNameLower) || 
                            descLower.includes(appNameLower)

          if (isRelevant && title.length > 20) {
            posts.push({
              text: description || title,
              title: title,
              score: 0,
              date: pubDateMatch ? new Date(pubDateMatch[1]).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
              subreddit: subreddit,
              url: linkMatch[1],
              author: 'RSS',
              searchTerm: appName
            })
          }
        }
      }
    } catch (error) {
      console.error('Error parsing RSS:', error)
    }

    return posts
  }

  // 主要抓取方法 - 尝试多种策略
  async scrapeReddit(appName: string): Promise<RedditPost[]> {
    const allPosts: RedditPost[] = []
    
    console.log(`Starting comprehensive Reddit scraping for: ${appName}`)

    // 策略1: JSON API (最重要)
    try {
      const jsonPosts = await this.scrapeWithJSONAPI(appName)
      allPosts.push(...jsonPosts)
      console.log(`JSON API strategy: ${jsonPosts.length} posts`)
    } catch (error) {
      console.error('JSON API strategy failed:', error)
    }

    // 策略2: Pushshift (历史数据)
    try {
      const pushshiftPosts = await this.scrapeWithPushshift(appName)
      allPosts.push(...pushshiftPosts)
      console.log(`Pushshift strategy: ${pushshiftPosts.length} posts`)
    } catch (error) {
      console.error('Pushshift strategy failed:', error)
    }

    // 策略3: RSS (备用)
    try {
      const rssPosts = await this.scrapeWithRSS(appName)
      allPosts.push(...rssPosts)
      console.log(`RSS strategy: ${rssPosts.length} posts`)
    } catch (error) {
      console.error('RSS strategy failed:', error)
    }

    // 去重和过滤
    const uniquePosts = this.deduplicateAndFilter(allPosts, appName)
    
    console.log(`Final result: ${uniquePosts.length} unique, relevant posts`)
    
    return uniquePosts
  }

  // 去重和过滤
  private deduplicateAndFilter(posts: RedditPost[], appName: string): RedditPost[] {
    // 去重 - 基于URL和文本内容
    const seen = new Set<string>()
    const uniquePosts = posts.filter(post => {
      const key = post.url || post.text.substring(0, 100)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    // 过滤和排序
    const appNameLower = appName.toLowerCase()
    
    const filteredPosts = uniquePosts.filter(post => {
      const text = post.text.toLowerCase()
      const title = post.title.toLowerCase()
      
      return (
        post.text.length >= 30 && 
        post.text.length <= 5000 &&
        post.score >= -5 && // 允许一些负分，但不要太低
        !text.includes('[removed]') &&
        !text.includes('[deleted]') &&
        !text.includes('automod') &&
        !text.includes('this post has been removed') &&
        // 确保真的提到了应用
        (text.includes(appNameLower) || 
         title.includes(appNameLower) ||
         text.includes(appNameLower.replace(/\s+/g, '')))
      )
    })

    // 按相关性和质量排序
    return filteredPosts
      .sort((a, b) => {
        // 计算相关性分数
        const scoreA = this.calculateRelevanceScore(a, appName)
        const scoreB = this.calculateRelevanceScore(b, appName)
        return scoreB - scoreA
      })
      .slice(0, 30) // 限制为前30个最相关的帖子
  }

  // 计算相关性分数
  private calculateRelevanceScore(post: RedditPost, appName: string): number {
    const appNameLower = appName.toLowerCase()
    const text = post.text.toLowerCase()
    const title = post.title.toLowerCase()
    
    let score = 0
    
    // 基础分数
    score += post.score * 0.1 // Reddit分数
    score += post.text.length / 100 // 内容长度
    
    // 相关性加分
    if (title.includes(appNameLower)) score += 10
    if (text.includes(appNameLower)) score += 5
    if (title.includes('review')) score += 3
    if (text.includes('review')) score += 2
    if (post.subreddit.includes('app')) score += 2
    
    // 质量指标
    if (post.upvoteRatio && post.upvoteRatio > 0.7) score += 3
    if (post.text.length > 200) score += 2
    
    return score
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { appName, scrapingSessionId }: ScrapeRequest = await req.json()

    if (!appName) {
      return new Response(
        JSON.stringify({ error: 'Missing appName' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    console.log(`Starting Reddit scraping for: ${appName}`)

    const scraper = new RedditScraper()
    const posts = await scraper.scrapeReddit(appName)

    // 保存到数据库
    if (scrapingSessionId && posts.length > 0) {
      try {
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
            upvote_ratio: post.upvoteRatio
          }
        }))

        const { error: saveError } = await supabaseClient
          .from('scraped_reviews')
          .insert(postsToSave)

        if (saveError) {
          console.error('Error saving Reddit posts:', saveError)
        } else {
          console.log(`Successfully saved ${postsToSave.length} Reddit posts to database`)
        }
      } catch (saveError) {
        console.error('Error in database save operation:', saveError)
      }
    }

    const stats = {
      totalPosts: posts.length,
      subreddits: [...new Set(posts.map(p => p.subreddit))],
      averageScore: posts.length > 0 ? posts.reduce((sum, p) => sum + p.score, 0) / posts.length : 0,
      dateRange: posts.length > 0 ? {
        earliest: Math.min(...posts.map(p => new Date(p.date).getTime())),
        latest: Math.max(...posts.map(p => new Date(p.date).getTime()))
      } : null
    }

    console.log(`Reddit scraping completed for ${appName}:`, stats)

    return new Response(
      JSON.stringify({ 
        posts,
        stats,
        message: `Successfully scraped ${posts.length} Reddit posts`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Critical error in Reddit scraping:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Failed to scrape Reddit',
        details: error.message,
        posts: [],
        stats: {
          totalPosts: 0,
          errorCount: 1
        }
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})