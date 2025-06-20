import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface ScrapeRequest {
  appName: string
  appId?: string
  scrapingSessionId?: string
  maxPages?: number
  countries?: string[]
}

interface Review {
  text: string
  rating: number
  date: string
  author: string
  title?: string
  version?: string
  country?: string
  page?: number
  reviewId?: string
}

interface ScrapingStats {
  totalReviews: number
  pagesCrawled: number
  countriesScraped: string[]
  dateRange: { earliest: string; latest: string } | null
  averageRating: number
  ratingDistribution: { [key: number]: number }
  reviewsPerCountry: { [country: string]: number }
  reviewsPerPage: { [page: number]: number }
  errors: string[]
  successfulRequests: number
  failedRequests: number
  totalApiCalls: number
  scrapingDuration: number
}

class AppStoreReviewScraper {
  private userAgents = [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  ]

  private countries = [
    'us', 'gb', 'ca', 'au', 'de', 'fr', 'jp', 'kr', 'cn', 'in',
    'br', 'mx', 'es', 'it', 'nl', 'se', 'no', 'dk', 'fi', 'ru'
  ]

  private rateLimitDelay = 1500 // 1.5秒延迟避免被限制
  private maxRetries = 3

  private getRandomUserAgent(): string {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)]
  }

  private async delay(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms))
  }

  // 🔍 策略1: 搜索应用获取App ID
  async searchApp(appName: string, country: string = 'us'): Promise<{ appId: string; appInfo: any } | null> {
    console.log(`🔍 [${country.toUpperCase()}] Searching for app: "${appName}"`)
    
    try {
      const searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(appName)}&entity=software&limit=10&country=${country}`
      
      const response = await fetch(searchUrl, {
        headers: {
          'User-Agent': this.getRandomUserAgent(),
          'Accept': 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache'
        }
      })

      if (!response.ok) {
        throw new Error(`Search failed: ${response.status} ${response.statusText}`)
      }

      const data = await response.json()
      
      if (!data.results || data.results.length === 0) {
        console.log(`❌ [${country.toUpperCase()}] No apps found for "${appName}"`)
        return null
      }

      // 寻找最匹配的应用
      const bestMatch = this.findBestMatch(data.results, appName)
      
      if (bestMatch) {
        console.log(`✅ [${country.toUpperCase()}] Found app: "${bestMatch.trackName}" (ID: ${bestMatch.trackId})`)
        console.log(`📊 [${country.toUpperCase()}] App info: Developer="${bestMatch.artistName}", Rating=${bestMatch.averageUserRating}, Reviews=${bestMatch.userRatingCount}`)
        
        return {
          appId: bestMatch.trackId.toString(),
          appInfo: {
            name: bestMatch.trackName,
            developer: bestMatch.artistName,
            rating: bestMatch.averageUserRating,
            reviewCount: bestMatch.userRatingCount,
            url: bestMatch.trackViewUrl,
            bundleId: bestMatch.bundleId,
            category: bestMatch.primaryGenreName,
            price: bestMatch.price,
            version: bestMatch.version,
            releaseDate: bestMatch.releaseDate
          }
        }
      }

      console.log(`❌ [${country.toUpperCase()}] No suitable match found for "${appName}"`)
      return null

    } catch (error) {
      console.error(`❌ [${country.toUpperCase()}] Search error:`, error.message)
      return null
    }
  }

  // 寻找最佳匹配的应用
  private findBestMatch(results: any[], searchTerm: string): any | null {
    const searchLower = searchTerm.toLowerCase()
    
    // 优先级1: 完全匹配应用名称
    for (const app of results) {
      if (app.trackName.toLowerCase() === searchLower) {
        return app
      }
    }

    // 优先级2: 应用名称包含搜索词
    for (const app of results) {
      if (app.trackName.toLowerCase().includes(searchLower)) {
        return app
      }
    }

    // 优先级3: 开发者名称包含搜索词
    for (const app of results) {
      if (app.artistName.toLowerCase().includes(searchLower)) {
        return app
      }
    }

    // 优先级4: 描述包含搜索词
    for (const app of results) {
      if (app.description && app.description.toLowerCase().includes(searchLower)) {
        return app
      }
    }

    // 如果都没有匹配，返回第一个结果
    return results[0] || null
  }

  // 🔍 策略2: 抓取单页评论
  async scrapeReviewsPage(appId: string, page: number, country: string = 'us'): Promise<Review[]> {
    console.log(`📄 [${country.toUpperCase()}] Scraping page ${page} for app ${appId}`)
    
    try {
      // 使用RSS feed获取评论，支持分页
      const reviewsUrl = `https://itunes.apple.com/rss/customerreviews/page=${page}/id=${appId}/sortby=mostrecent/json?l=en&cc=${country}`
      
      console.log(`🌐 [${country.toUpperCase()}] Request URL: ${reviewsUrl}`)
      
      const response = await fetch(reviewsUrl, {
        headers: {
          'User-Agent': this.getRandomUserAgent(),
          'Accept': 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      
      if (!data.feed || !data.feed.entry) {
        console.log(`⚠️ [${country.toUpperCase()}] Page ${page}: No entries found`)
        return []
      }

      const entries = data.feed.entry
      const reviews: Review[] = []

      // 跳过第一个entry（通常是应用信息，不是评论）
      const reviewEntries = Array.isArray(entries) ? entries.slice(1) : []
      
      console.log(`📊 [${country.toUpperCase()}] Page ${page}: Found ${reviewEntries.length} entries`)

      for (let i = 0; i < reviewEntries.length; i++) {
        const entry = reviewEntries[i]
        
        try {
          if (entry.content && entry.content.label) {
            const review: Review = {
              text: entry.content.label,
              rating: entry['im:rating'] ? parseInt(entry['im:rating'].label) : 3,
              date: entry.updated ? entry.updated.label.split('T')[0] : new Date().toISOString().split('T')[0],
              author: entry.author ? entry.author.name.label : 'Anonymous',
              title: entry.title ? entry.title.label : '',
              version: entry['im:version'] ? entry['im:version'].label : '',
              country: country.toUpperCase(),
              page: page,
              reviewId: entry.id ? entry.id.label : `${appId}_${country}_${page}_${i}`
            }

            // 过滤掉过短或无效的评论
            if (review.text.length >= 10 && review.text.length <= 5000) {
              reviews.push(review)
            }
          }
        } catch (entryError) {
          console.error(`⚠️ [${country.toUpperCase()}] Page ${page}: Error parsing entry ${i}:`, entryError.message)
        }
      }

      console.log(`✅ [${country.toUpperCase()}] Page ${page}: Extracted ${reviews.length} valid reviews`)
      return reviews

    } catch (error) {
      console.error(`❌ [${country.toUpperCase()}] Page ${page}: Scraping failed:`, error.message)
      return []
    }
  }

  // 🔍 策略3: 多页抓取（带重试机制）
  async scrapeMultiplePages(appId: string, maxPages: number, country: string = 'us'): Promise<Review[]> {
    console.log(`📚 [${country.toUpperCase()}] Starting multi-page scraping: ${maxPages} pages for app ${appId}`)
    
    const allReviews: Review[] = []
    let consecutiveEmptyPages = 0
    const maxEmptyPages = 3 // 连续3页没有评论就停止

    for (let page = 1; page <= maxPages; page++) {
      try {
        console.log(`🔄 [${country.toUpperCase()}] Processing page ${page}/${maxPages}`)
        
        const pageReviews = await this.scrapeReviewsPage(appId, page, country)
        
        if (pageReviews.length === 0) {
          consecutiveEmptyPages++
          console.log(`⚠️ [${country.toUpperCase()}] Page ${page}: Empty page (${consecutiveEmptyPages}/${maxEmptyPages} consecutive empty pages)`)
          
          if (consecutiveEmptyPages >= maxEmptyPages) {
            console.log(`🛑 [${country.toUpperCase()}] Stopping: ${maxEmptyPages} consecutive empty pages reached`)
            break
          }
        } else {
          consecutiveEmptyPages = 0 // 重置计数器
          allReviews.push(...pageReviews)
          console.log(`📈 [${country.toUpperCase()}] Page ${page}: Added ${pageReviews.length} reviews (Total: ${allReviews.length})`)
        }

        // 添加延迟避免被限制
        if (page < maxPages) {
          console.log(`⏳ [${country.toUpperCase()}] Waiting ${this.rateLimitDelay}ms before next page...`)
          await this.delay(this.rateLimitDelay)
        }

      } catch (error) {
        console.error(`❌ [${country.toUpperCase()}] Page ${page}: Error:`, error.message)
        
        // 重试机制
        for (let retry = 1; retry <= this.maxRetries; retry++) {
          console.log(`🔄 [${country.toUpperCase()}] Page ${page}: Retry ${retry}/${this.maxRetries}`)
          
          await this.delay(this.rateLimitDelay * retry) // 递增延迟
          
          try {
            const retryReviews = await this.scrapeReviewsPage(appId, page, country)
            if (retryReviews.length > 0) {
              allReviews.push(...retryReviews)
              console.log(`✅ [${country.toUpperCase()}] Page ${page}: Retry successful, added ${retryReviews.length} reviews`)
              break
            }
          } catch (retryError) {
            console.error(`❌ [${country.toUpperCase()}] Page ${page}: Retry ${retry} failed:`, retryError.message)
            if (retry === this.maxRetries) {
              console.log(`🛑 [${country.toUpperCase()}] Page ${page}: All retries exhausted, skipping page`)
            }
          }
        }
      }
    }

    console.log(`🏁 [${country.toUpperCase()}] Multi-page scraping completed: ${allReviews.length} total reviews from ${Math.min(page - 1, maxPages)} pages`)
    return allReviews
  }

  // 🔍 策略4: 多国家抓取
  async scrapeMultipleCountries(appId: string, maxPages: number, countries: string[]): Promise<Review[]> {
    console.log(`🌍 Starting multi-country scraping for app ${appId}`)
    console.log(`🎯 Target countries: ${countries.join(', ').toUpperCase()}`)
    console.log(`📄 Pages per country: ${maxPages}`)
    
    const allReviews: Review[] = []
    const countryResults: { [country: string]: number } = {}

    for (let i = 0; i < countries.length; i++) {
      const country = countries[i]
      console.log(`\n🌍 [${i + 1}/${countries.length}] Processing country: ${country.toUpperCase()}`)
      
      try {
        const countryReviews = await this.scrapeMultiplePages(appId, maxPages, country)
        allReviews.push(...countryReviews)
        countryResults[country] = countryReviews.length
        
        console.log(`✅ [${country.toUpperCase()}] Country completed: ${countryReviews.length} reviews`)
        
        // 国家间延迟
        if (i < countries.length - 1) {
          console.log(`⏳ Waiting ${this.rateLimitDelay * 2}ms before next country...`)
          await this.delay(this.rateLimitDelay * 2)
        }

      } catch (error) {
        console.error(`❌ [${country.toUpperCase()}] Country failed:`, error.message)
        countryResults[country] = 0
      }
    }

    console.log(`\n🏁 Multi-country scraping completed!`)
    console.log(`📊 Results by country:`)
    for (const [country, count] of Object.entries(countryResults)) {
      console.log(`   ${country.toUpperCase()}: ${count} reviews`)
    }
    console.log(`🎯 Total reviews: ${allReviews.length}`)

    return allReviews
  }

  // 🔍 主要抓取方法
  async scrapeAppStoreReviews(
    appName: string, 
    appId?: string, 
    maxPages: number = 25, 
    countries: string[] = ['us']
  ): Promise<{ reviews: Review[]; stats: ScrapingStats; appInfo?: any }> {
    const startTime = Date.now()
    console.log(`\n🚀 === ADVANCED APP STORE SCRAPER STARTED ===`)
    console.log(`📱 App Name: "${appName}"`)
    console.log(`🆔 App ID: ${appId || 'Will search automatically'}`)
    console.log(`📄 Max Pages: ${maxPages}`)
    console.log(`🌍 Countries: ${countries.join(', ').toUpperCase()}`)
    console.log(`⏰ Start Time: ${new Date().toISOString()}`)

    const stats: ScrapingStats = {
      totalReviews: 0,
      pagesCrawled: 0,
      countriesScraped: [],
      dateRange: null,
      averageRating: 0,
      ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      reviewsPerCountry: {},
      reviewsPerPage: {},
      errors: [],
      successfulRequests: 0,
      failedRequests: 0,
      totalApiCalls: 0,
      scrapingDuration: 0
    }

    let finalAppId = appId
    let appInfo = null

    try {
      // 步骤1: 如果没有提供App ID，先搜索
      if (!finalAppId) {
        console.log(`\n🔍 === STEP 1: APP SEARCH ===`)
        
        for (const country of countries.slice(0, 3)) { // 只在前3个国家搜索
          const searchResult = await this.searchApp(appName, country)
          stats.totalApiCalls++
          
          if (searchResult) {
            finalAppId = searchResult.appId
            appInfo = searchResult.appInfo
            console.log(`✅ App found in ${country.toUpperCase()}: ID=${finalAppId}`)
            break
          }
        }

        if (!finalAppId) {
          throw new Error(`App "${appName}" not found in any country`)
        }
      }

      // 步骤2: 多国家多页抓取
      console.log(`\n📚 === STEP 2: MULTI-COUNTRY REVIEW SCRAPING ===`)
      const allReviews = await this.scrapeMultipleCountries(finalAppId, maxPages, countries)

      // 步骤3: 数据处理和统计
      console.log(`\n📊 === STEP 3: DATA PROCESSING ===`)
      
      // 去重（基于reviewId和内容）
      const uniqueReviews = this.deduplicateReviews(allReviews)
      console.log(`🔄 Deduplication: ${allReviews.length} → ${uniqueReviews.length} reviews`)

      // 按日期排序（最新的在前）
      uniqueReviews.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

      // 计算统计信息
      stats.totalReviews = uniqueReviews.length
      stats.scrapingDuration = Date.now() - startTime
      stats.totalApiCalls += countries.length * maxPages // 估算API调用次数

      if (uniqueReviews.length > 0) {
        // 日期范围
        const dates = uniqueReviews.map(r => r.date).sort()
        stats.dateRange = {
          earliest: dates[0],
          latest: dates[dates.length - 1]
        }

        // 平均评分
        stats.averageRating = parseFloat(
          (uniqueReviews.reduce((sum, r) => sum + r.rating, 0) / uniqueReviews.length).toFixed(1)
        )

        // 评分分布
        for (const review of uniqueReviews) {
          stats.ratingDistribution[review.rating] = (stats.ratingDistribution[review.rating] || 0) + 1
        }

        // 按国家统计
        for (const review of uniqueReviews) {
          const country = review.country || 'UNKNOWN'
          stats.reviewsPerCountry[country] = (stats.reviewsPerCountry[country] || 0) + 1
        }

        // 按页面统计
        for (const review of uniqueReviews) {
          const page = review.page || 0
          stats.reviewsPerPage[page] = (stats.reviewsPerPage[page] || 0) + 1
        }

        stats.countriesScraped = Object.keys(stats.reviewsPerCountry)
        stats.pagesCrawled = Object.keys(stats.reviewsPerPage).length
      }

      // 步骤4: 输出最终统计
      console.log(`\n🎯 === FINAL RESULTS ===`)
      console.log(`✅ Total Reviews: ${stats.totalReviews}`)
      console.log(`🌍 Countries Scraped: ${stats.countriesScraped.join(', ')}`)
      console.log(`📄 Pages Crawled: ${stats.pagesCrawled}`)
      console.log(`⭐ Average Rating: ${stats.averageRating}`)
      console.log(`📅 Date Range: ${stats.dateRange?.earliest} to ${stats.dateRange?.latest}`)
      console.log(`⏱️ Duration: ${(stats.scrapingDuration / 1000).toFixed(1)}s`)
      console.log(`🔗 API Calls: ${stats.totalApiCalls}`)
      
      console.log(`📊 Rating Distribution:`)
      for (let i = 1; i <= 5; i++) {
        console.log(`   ${i}⭐: ${stats.ratingDistribution[i]} reviews`)
      }
      
      console.log(`🌍 Reviews by Country:`)
      for (const [country, count] of Object.entries(stats.reviewsPerCountry)) {
        console.log(`   ${country}: ${count} reviews`)
      }

      return {
        reviews: uniqueReviews,
        stats,
        appInfo
      }

    } catch (error) {
      stats.errors.push(error.message)
      stats.scrapingDuration = Date.now() - startTime
      
      console.error(`❌ === SCRAPING FAILED ===`)
      console.error(`Error: ${error.message}`)
      console.error(`Duration: ${(stats.scrapingDuration / 1000).toFixed(1)}s`)
      
      throw error
    }
  }

  // 去重方法
  private deduplicateReviews(reviews: Review[]): Review[] {
    const seen = new Set<string>()
    const unique: Review[] = []

    for (const review of reviews) {
      // 创建唯一标识符（基于内容和作者）
      const identifier = `${review.text.substring(0, 100)}_${review.author}_${review.date}`
      
      if (!seen.has(identifier)) {
        seen.add(identifier)
        unique.push(review)
      }
    }

    return unique
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
      appId, 
      scrapingSessionId, 
      maxPages = 25, 
      countries = ['us', 'gb', 'ca', 'au', 'de'] 
    }: ScrapeRequest = await req.json()

    if (!appName && !appId) {
      return new Response(
        JSON.stringify({ error: 'Missing appName or appId' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    console.log(`🚀 App Store scraping request received`)
    console.log(`📱 App: ${appName || 'Unknown'} (ID: ${appId || 'Auto-detect'})`)
    console.log(`📄 Max Pages: ${maxPages}`)
    console.log(`🌍 Countries: ${countries.join(', ')}`)

    const scraper = new AppStoreReviewScraper()
    const result = await scraper.scrapeAppStoreReviews(appName, appId, maxPages, countries)

    // 保存到数据库
    if (scrapingSessionId && result.reviews.length > 0) {
      try {
        console.log(`💾 Saving ${result.reviews.length} reviews to database...`)
        
        const supabaseClient = createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        const reviewsToSave = result.reviews.map(review => ({
          scraping_session_id: scrapingSessionId,
          platform: 'app_store' as const,
          review_text: review.text,
          rating: review.rating,
          review_date: review.date,
          author_name: review.author,
          source_url: `https://apps.apple.com/app/id${appId || 'unknown'}`,
          additional_data: {
            app_id: appId,
            app_name: appName,
            title: review.title,
            version: review.version,
            country: review.country,
            page: review.page,
            review_id: review.reviewId,
            scraper_version: 'advanced_multi_v2.0',
            scraping_stats: result.stats
          }
        }))

        const { error: saveError } = await supabaseClient
          .from('scraped_reviews')
          .insert(reviewsToSave)

        if (saveError) {
          console.error('❌ Database save error:', saveError)
        } else {
          console.log(`✅ Successfully saved ${reviewsToSave.length} reviews to database`)
        }

      } catch (saveError) {
        console.error('❌ Error saving to database:', saveError)
      }
    }

    return new Response(
      JSON.stringify({ 
        reviews: result.reviews,
        appInfo: result.appInfo || {
          name: appName,
          id: appId,
          url: `https://apps.apple.com/app/id${appId || 'unknown'}`
        },
        stats: result.stats,
        message: `Successfully scraped ${result.reviews.length} reviews from ${result.stats.countriesScraped.length} countries across ${result.stats.pagesCrawled} pages`,
        timestamp: new Date().toISOString(),
        scraper_version: 'advanced_multi_v2.0'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('❌ Critical error in App Store scraping:', error)
    
    return new Response(
      JSON.stringify({ 
        error: 'Failed to scrape App Store',
        details: error.message,
        reviews: [],
        stats: {
          totalReviews: 0,
          errors: [error.message],
          scrapingDuration: 0,
          totalApiCalls: 0
        },
        timestamp: new Date().toISOString(),
        scraper_version: 'advanced_multi_v2.0'
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})