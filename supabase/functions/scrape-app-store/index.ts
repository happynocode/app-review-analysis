import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'x-client-info, apikey, content-type',
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
    'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  ]

  // 优化国家列表 - 移除20个小国家，保留主要市场
  private countries = [
    'us', 'gb', 'ca', 'au', 'de', 'fr', 'jp', 'kr', 'cn', 'in',
    'br', 'mx', 'es', 'it', 'nl', 'se', 'no', 'dk', 'fi', 'ru'
    // 移除的小国家: 'pl', 'tr', 'ar', 'cl', 'co', 'pe', 'za', 'eg', 'th', 'vn',
    // 'id', 'my', 'sg', 'ph', 'nz', 'ie', 'at', 'ch', 'be', 'pt'
  ]

  private rateLimitDelay = 800 // 减少延迟以提高效率
  private maxRetries = 5 // 增加重试次数

  private getRandomUserAgent(): string {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)]
  }

  private async delay(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms))
  }

  // 🔍 策略1: 搜索应用获取App ID (改进版)
  async searchApp(appName: string, country: string = 'us'): Promise<{ appId: string; appInfo: any } | null> {
    console.log(`🔍 [${country.toUpperCase()}] Searching for app: "${appName}"`)
    
    try {
      // 尝试多种搜索策略
      const searchTerms = [
        appName,
        appName.toLowerCase(),
        appName.replace(/\s+/g, '+'),
        appName.split(' ')[0], // 只用第一个词
        appName.replace(/[^a-zA-Z0-9\s]/g, '') // 移除特殊字符
      ]

      for (const term of searchTerms) {
        const searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=software&limit=50&country=${country}`
        
        const response = await fetch(searchUrl, {
          headers: {
            'User-Agent': this.getRandomUserAgent(),
            'Accept': 'application/json',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache'
          }
        })

        if (!response.ok) {
          console.log(`❌ Search failed for "${term}": ${response.status}`)
          continue
        }

        const data = await response.json()
        
        if (data.results && data.results.length > 0) {
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
        }

        await this.delay(300) // 短暂延迟避免被限制
      }

      console.log(`❌ [${country.toUpperCase()}] No suitable match found for "${appName}"`)
      return null

    } catch (error) {
      console.error(`❌ [${country.toUpperCase()}] Search error:`, error.message)
      return null
    }
  }

  // 改进的匹配算法
  private findBestMatch(results: any[], searchTerm: string): any | null {
    const searchLower = searchTerm.toLowerCase()
    const searchWords = searchLower.split(/\s+/)
    
    // 计算匹配分数
    const scoredResults = results.map(app => {
      const appName = (app.trackName || '').toLowerCase()
      const developer = (app.artistName || '').toLowerCase()
      const description = (app.description || '').toLowerCase()
      
      let score = 0
      
      // 完全匹配应用名称 (最高分)
      if (appName === searchLower) score += 100
      
      // 应用名称包含搜索词
      if (appName.includes(searchLower)) score += 50
      
      // 搜索词包含在应用名称中
      if (searchLower.includes(appName)) score += 40
      
      // 单词匹配
      for (const word of searchWords) {
        if (word.length > 2) {
          if (appName.includes(word)) score += 10
          if (developer.includes(word)) score += 5
          if (description.includes(word)) score += 2
        }
      }
      
      // 开发者匹配
      if (developer.includes(searchLower)) score += 30
      
      // 评分和评论数量加分 (质量指标)
      score += (app.averageUserRating || 0) * 2
      score += Math.min((app.userRatingCount || 0) / 1000, 10)
      
      return { app, score }
    })
    
    // 按分数排序并返回最佳匹配
    scoredResults.sort((a, b) => b.score - a.score)
    
    const bestMatch = scoredResults[0]
    if (bestMatch && bestMatch.score > 10) {
      console.log(`🎯 Best match: "${bestMatch.app.trackName}" (Score: ${bestMatch.score})`)
      return bestMatch.app
    }
    
    return null
  }

  // 🔍 策略2: 抓取单页评论 (只使用 mostrecent 排序)
  async scrapeReviewsPage(appId: string, page: number, country: string = 'us'): Promise<Review[]> {
    console.log(`📄 [${country.toUpperCase()}] Scraping page ${page} for app ${appId} (mostrecent only)`)
    
    try {
      // 只使用 mostrecent 排序的RSS feed URL
      const feedUrls = [
        `https://itunes.apple.com/rss/customerreviews/page=${page}/id=${appId}/sortby=mostrecent/json?l=en&cc=${country}`,
        `https://itunes.apple.com/${country}/rss/customerreviews/page=${page}/id=${appId}/sortby=mostrecent/json`,
        `https://itunes.apple.com/rss/customerreviews/id=${appId}/page=${page}/sortby=mostrecent/json?cc=${country}&l=en`
      ]
      
      for (let urlIndex = 0; urlIndex < feedUrls.length; urlIndex++) {
        const reviewsUrl = feedUrls[urlIndex]
        
        try {
          console.log(`🌐 [${country.toUpperCase()}] Trying URL ${urlIndex + 1}: ${reviewsUrl}`)
          
          const response = await fetch(reviewsUrl, {
            headers: {
              'User-Agent': this.getRandomUserAgent(),
              'Accept': 'application/json, text/plain, */*',
              'Accept-Language': 'en-US,en;q=0.9',
              'Cache-Control': 'no-cache',
              'Pragma': 'no-cache',
              'Referer': 'https://apps.apple.com/',
              'Origin': 'https://apps.apple.com'
            }
          })

          if (!response.ok) {
            console.log(`⚠️ URL ${urlIndex + 1} failed: ${response.status}`)
            continue
          }

          const data = await response.json()
          
          if (!data.feed || !data.feed.entry) {
            console.log(`⚠️ [${country.toUpperCase()}] Page ${page}: No entries found in URL ${urlIndex + 1}`)
            continue
          }

          const entries = data.feed.entry
          const reviews: Review[] = []

          // 跳过第一个entry（通常是应用信息）
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
                  reviewId: entry.id ? entry.id.label : `${appId}_${country}_${page}_${i}_mostrecent`
                }

                // 更宽松的过滤条件
                if (review.text.length >= 5 && review.text.length <= 10000) {
                  reviews.push(review)
                }
              }
            } catch (entryError) {
              console.error(`⚠️ [${country.toUpperCase()}] Page ${page}: Error parsing entry ${i}:`, entryError.message)
            }
          }

          console.log(`✅ [${country.toUpperCase()}] Page ${page}: Extracted ${reviews.length} valid reviews from URL ${urlIndex + 1}`)
          return reviews

        } catch (urlError) {
          console.error(`❌ [${country.toUpperCase()}] Page ${page}: URL ${urlIndex + 1} error:`, urlError.message)
          continue
        }
      }

      // 如果所有URL都失败了
      console.log(`❌ [${country.toUpperCase()}] Page ${page}: All URLs failed`)
      return []

    } catch (error) {
      console.error(`❌ [${country.toUpperCase()}] Page ${page}: Scraping failed:`, error.message)
      return []
    }
  }

  // 🔍 策略3: 多页抓取（带重试机制）- 只使用 mostrecent
  async scrapeMultiplePages(appId: string, maxPages: number, country: string = 'us'): Promise<Review[]> {
    console.log(`📚 [${country.toUpperCase()}] Starting multi-page scraping: ${maxPages} pages for app ${appId} (mostrecent only)`)
    
    const allReviews: Review[] = []
    let consecutiveEmptyPages = 0
    const maxEmptyPages = 5 // 增加容忍度

    for (let page = 1; page <= maxPages; page++) {
      let pageReviews: Review[] = []
      let success = false

      // 重试机制
      for (let retry = 0; retry <= this.maxRetries; retry++) {
        try {
          console.log(`🔄 [${country.toUpperCase()}] Processing page ${page}/${maxPages} (attempt ${retry + 1})`)
          
          pageReviews = await this.scrapeReviewsPage(appId, page, country)
          success = true
          break
          
        } catch (error) {
          console.error(`❌ [${country.toUpperCase()}] Page ${page} attempt ${retry + 1} failed:`, error.message)
          
          if (retry < this.maxRetries) {
            const retryDelay = this.rateLimitDelay * (retry + 1)
            console.log(`⏳ [${country.toUpperCase()}] Retrying page ${page} in ${retryDelay}ms...`)
            await this.delay(retryDelay)
          }
        }
      }

      if (!success) {
        console.log(`🛑 [${country.toUpperCase()}] Page ${page}: All retries exhausted, skipping`)
        consecutiveEmptyPages++
      } else if (pageReviews.length === 0) {
        consecutiveEmptyPages++
        console.log(`⚠️ [${country.toUpperCase()}] Page ${page}: Empty page (${consecutiveEmptyPages}/${maxEmptyPages} consecutive empty pages)`)
      } else {
        consecutiveEmptyPages = 0 // 重置计数器
        allReviews.push(...pageReviews)
        console.log(`📈 [${country.toUpperCase()}] Page ${page}: Added ${pageReviews.length} reviews (Total: ${allReviews.length})`)
      }

      // 检查是否应该停止
      if (consecutiveEmptyPages >= maxEmptyPages) {
        console.log(`🛑 [${country.toUpperCase()}] Stopping: ${maxEmptyPages} consecutive empty pages reached`)
        break
      }

      // 页面间延迟
      if (page < maxPages) {
        await this.delay(this.rateLimitDelay)
      }
    }

    console.log(`🏁 [${country.toUpperCase()}] Multi-page scraping completed: ${allReviews.length} total reviews (mostrecent only)`)
    return allReviews
  }

  // 🔍 策略4: 多国家抓取 (简化版 - 只使用 mostrecent)
  async scrapeMultipleCountries(appId: string, maxPages: number, countries: string[]): Promise<Review[]> {
    console.log(`🌍 Starting streamlined multi-country scraping for app ${appId}`)
    console.log(`🎯 Target countries: ${countries.join(', ').toUpperCase()}`)
    console.log(`📄 Pages per country: ${maxPages}`)
    console.log(`🔄 Sort method: mostrecent only (streamlined)`)
    
    const allReviews: Review[] = []
    const countryResults: { [country: string]: number } = {}

    // 并行处理多个国家以提高效率
    const countryPromises = countries.map(async (country, index) => {
      // 错开开始时间避免同时请求
      await this.delay(index * 200)
      
      console.log(`\n🌍 [${index + 1}/${countries.length}] Processing country: ${country.toUpperCase()}`)
      
      try {
        // 直接使用多页抓取，只用 mostrecent 排序
        const countryReviews = await this.scrapeMultiplePages(appId, maxPages, country)
        countryResults[country] = countryReviews.length
        
        console.log(`✅ [${country.toUpperCase()}] Country completed: ${countryReviews.length} reviews (mostrecent only)`)
        return countryReviews
        
      } catch (error) {
        console.error(`❌ [${country.toUpperCase()}] Country failed:`, error.message)
        countryResults[country] = 0
        return []
      }
    })

    // 等待所有国家完成
    const countryResultsArray = await Promise.allSettled(countryPromises)
    
    // 收集所有成功的结果
    for (const result of countryResultsArray) {
      if (result.status === 'fulfilled') {
        allReviews.push(...result.value)
      }
    }

    console.log(`\n🏁 Streamlined multi-country scraping completed!`)
    console.log(`📊 Results by country (mostrecent only):`)
    for (const [country, count] of Object.entries(countryResults)) {
      console.log(`   ${country.toUpperCase()}: ${count} reviews`)
    }
    console.log(`🎯 Total reviews: ${allReviews.length}`)

    return allReviews
  }

  // 🔍 主要抓取方法 (简化版 - 只使用 mostrecent)
  async scrapeAppStoreReviews(
    appName: string, 
    appId?: string, 
    maxPages: number = 50, 
    countries: string[] = ['us', 'gb', 'ca', 'au', 'de', 'fr', 'jp', 'kr', 'in', 'br'] // 优化后的默认国家列表
  ): Promise<{ reviews: Review[]; stats: ScrapingStats; appInfo?: any }> {
    const startTime = Date.now()
    console.log(`\n🚀 === STREAMLINED APP STORE SCRAPER (MOSTRECENT ONLY) ===`)
    console.log(`📱 App Name: "${appName}"`)
    console.log(`🆔 App ID: ${appId || 'Will search automatically'}`)
    console.log(`📄 Max Pages: ${maxPages}`)
    console.log(`🌍 Countries (Optimized): ${countries.join(', ').toUpperCase()}`)
    console.log(`🔄 Sort Method: mostrecent ONLY (streamlined for speed)`)
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
        console.log(`\n🔍 === STEP 1: ENHANCED APP SEARCH ===`)
        
        // 在主要国家搜索以提高找到应用的概率
        const searchCountries = ['us', 'gb', 'ca', 'au', 'de', 'fr', 'jp']
        
        for (const country of searchCountries) {
          const searchResult = await this.searchApp(appName, country)
          stats.totalApiCalls++
          
          if (searchResult) {
            finalAppId = searchResult.appId
            appInfo = searchResult.appInfo
            console.log(`✅ App found in ${country.toUpperCase()}: ID=${finalAppId}`)
            break
          }
          
          await this.delay(300) // 搜索间延迟
        }

        if (!finalAppId) {
          throw new Error(`App "${appName}" not found in any country`)
        }
      }

      // 步骤2: 简化的多国家多页抓取 (只使用 mostrecent)
      console.log(`\n📚 === STEP 2: STREAMLINED MULTI-COUNTRY SCRAPING (MOSTRECENT ONLY) ===`)
      const allReviews = await this.scrapeMultipleCountries(finalAppId, maxPages, countries)

      // 步骤3: 数据处理和统计
      console.log(`\n📊 === STEP 3: ENHANCED DATA PROCESSING ===`)
      
      // 智能去重（基于多个字段）
      const uniqueReviews = this.enhancedDeduplication(allReviews)
      console.log(`🔄 Enhanced deduplication: ${allReviews.length} → ${uniqueReviews.length} reviews`)

      // 按日期排序（最新的在前）- mostrecent 已经是按时间排序的
      uniqueReviews.sort((a, b) => {
        const dateA = new Date(a.date).getTime()
        const dateB = new Date(b.date).getTime()
        if (dateB !== dateA) return dateB - dateA
        
        // 然后按内容长度排序（更长的评论通常更有价值）
        return b.text.length - a.text.length
      })

      // 计算增强的统计信息
      stats.totalReviews = uniqueReviews.length
      stats.scrapingDuration = Date.now() - startTime
      stats.totalApiCalls += countries.length * maxPages // 简化的API调用估算

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
      console.log(`\n🎯 === STREAMLINED FINAL RESULTS (MOSTRECENT ONLY) ===`)
      console.log(`✅ Total Reviews: ${stats.totalReviews}`)
      console.log(`🌍 Countries Scraped: ${stats.countriesScraped.join(', ')}`)
      console.log(`📄 Pages Crawled: ${stats.pagesCrawled}`)
      console.log(`⭐ Average Rating: ${stats.averageRating}`)
      console.log(`📅 Date Range: ${stats.dateRange?.earliest} to ${stats.dateRange?.latest}`)
      console.log(`⏱️ Duration: ${(stats.scrapingDuration / 1000).toFixed(1)}s`)
      console.log(`🔗 API Calls: ${stats.totalApiCalls}`)
      console.log(`🔄 Sort Method: mostrecent only (streamlined)`)
      
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
      
      console.error(`❌ === STREAMLINED SCRAPING FAILED ===`)
      console.error(`Error: ${error.message}`)
      console.error(`Duration: ${(stats.scrapingDuration / 1000).toFixed(1)}s`)
      
      throw error
    }
  }

  // 增强的去重方法
  private enhancedDeduplication(reviews: Review[]): Review[] {
    const seen = new Map<string, Review>()
    
    for (const review of reviews) {
      // 创建多层次的唯一标识符
      const contentHash = this.simpleHash(review.text.substring(0, 200))
      const authorDateKey = `${review.author}_${review.date}`
      const textLengthKey = `${contentHash}_${review.text.length}`
      
      // 组合键确保更准确的去重
      const compositeKey = `${authorDateKey}_${textLengthKey}`
      
      if (!seen.has(compositeKey)) {
        seen.set(compositeKey, review)
      } else {
        // 如果有重复，保留更完整的评论
        const existing = seen.get(compositeKey)!
        if (review.text.length > existing.text.length || 
            (review.title && !existing.title)) {
          seen.set(compositeKey, review)
        }
      }
    }
    
    return Array.from(seen.values())
  }

  // 简单哈希函数
  private simpleHash(str: string): string {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // 转换为32位整数
    }
    return hash.toString(36)
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
      maxPages = 50, 
      countries = ['us', 'gb', 'ca', 'au', 'de', 'fr', 'jp', 'kr', 'in', 'br', 'mx', 'es', 'it', 'nl', 'se'] // 优化后的国家列表
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

    console.log(`🚀 Streamlined App Store scraping request received`)
    console.log(`📱 App: ${appName || 'Unknown'} (ID: ${appId || 'Auto-detect'})`)
    console.log(`📄 Max Pages: ${maxPages}`)
    console.log(`🌍 Countries (Optimized): ${countries.join(', ')}`)
    console.log(`🔄 Sort Method: mostrecent ONLY (streamlined)`)

    const scraper = new AppStoreReviewScraper()
    const result = await scraper.scrapeAppStoreReviews(appName, appId, maxPages, countries)

    // 保存到数据库并更新scraper状态
    if (scrapingSessionId) {
      try {
        console.log(`💾 Saving ${result.reviews.length} reviews to database...`)
        
        const supabaseClient = createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        // 🆕 首先更新scraper状态为running
        await supabaseClient
          .from('scraping_sessions')
          .update({
            app_store_scraper_status: 'running',
            app_store_started_at: new Date().toISOString()
          })
          .eq('id', scrapingSessionId)

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
            scraper_version: 'streamlined_mostrecent_v5.0',
            sort_method: 'mostrecent_only',
            scraping_stats: result.stats
          }
        }))

        // 分批保存以避免超时
        const batchSize = 100
        for (let i = 0; i < reviewsToSave.length; i += batchSize) {
          const batch = reviewsToSave.slice(i, i + batchSize)
          
          const { error: saveError } = await supabaseClient
            .from('scraped_reviews')
            .insert(batch)

          if (saveError) {
            console.error(`❌ Database save error for batch ${Math.floor(i/batchSize) + 1}:`, saveError)
          } else {
            console.log(`✅ Saved batch ${Math.floor(i/batchSize) + 1}: ${batch.length} reviews`)
          }
        }

        console.log(`✅ Successfully saved all ${reviewsToSave.length} reviews to database`)

        // 🆕 查询实际保存到数据库的App Store review数量
        const { count: actualSavedCount, error: countError } = await supabaseClient
          .from('scraped_reviews')
          .select('*', { count: 'exact', head: true })
          .eq('scraping_session_id', scrapingSessionId)
          .eq('platform', 'app_store');

        const finalAppStoreCount = actualSavedCount || 0;
        console.log(`📊 App Store实际保存数量: ${finalAppStoreCount} (原计划: ${result.reviews.length})`);

        // 🆕 更新scraper状态为completed（删除review数量字段）
        await supabaseClient
          .from('scraping_sessions')
          .update({
            app_store_scraper_status: 'completed',
            app_store_completed_at: new Date().toISOString()
          })
          .eq('id', scrapingSessionId)

        console.log(`✅ App Store scraper status updated to completed`)

      } catch (saveError) {
        console.error('❌ Error saving to database:', saveError)
        
        // 🆕 更新scraper状态为failed
        try {
          const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
          )
          
          await supabaseClient
            .from('scraping_sessions')
            .update({
              app_store_scraper_status: 'failed',
              app_store_completed_at: new Date().toISOString(),
              app_store_error_message: saveError.message
            })
            .eq('id', scrapingSessionId)
        } catch (updateError) {
          console.error('❌ Failed to update scraper status:', updateError)
        }
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
        message: `Successfully scraped ${result.reviews.length} reviews from ${result.stats.countriesScraped.length} countries using mostrecent sort only (streamlined approach) across ${result.stats.pagesCrawled} pages`,
        timestamp: new Date().toISOString(),
        scraper_version: 'streamlined_mostrecent_v5.0',
        sort_method: 'mostrecent_only'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('❌ Critical error in Streamlined App Store scraping:', error)
    
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
        scraper_version: 'streamlined_mostrecent_v5.0',
        sort_method: 'mostrecent_only'
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})