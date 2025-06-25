import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}


interface SearchAppsRequest {
  companyName: string
  reportId?: string
}

interface AppInfo {
  id: string
  name: string
  developer: string
  platform: 'ios' | 'android'
  packageId: string // Bundle ID for iOS, Package Name for Android
  iconUrl?: string
  description?: string
  category?: string
  rating?: number
  reviewCount?: number
  url: string
  lastUpdated?: string
}

interface SearchResult {
  query: string
  iosApps: AppInfo[]
  androidApps: AppInfo[]
  totalFound: number
  suggestions: string[]
}

class AppSearcher {
  private rateLimitDelay = 2000
  private userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  ]

  private async delay(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms))
  }

  private getRandomUserAgent(): string {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)]
  }

  // 搜索 iOS 应用
  async searchIOSApps(companyName: string): Promise<AppInfo[]> {
    const apps: AppInfo[] = []
    
    try {
      console.log(`Searching iOS App Store for: ${companyName}`)
      
      // 使用 iTunes Search API
      const searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(companyName)}&entity=software&limit=50&country=US`
      
      const response = await fetch(searchUrl, {
        headers: {
          'User-Agent': this.getRandomUserAgent()
        }
      })

      if (!response.ok) {
        throw new Error(`iOS search failed: ${response.status}`)
      }

      const data = await response.json()
      
      if (data.results && data.results.length > 0) {
        for (const app of data.results) {
          // 检查是否与公司名称相关
          if (this.isRelevantApp(app, companyName)) {
            apps.push({
              id: app.trackId.toString(),
              name: app.trackName,
              developer: app.artistName,
              platform: 'ios',
              packageId: app.bundleId,
              iconUrl: app.artworkUrl512 || app.artworkUrl100,
              description: app.description,
              category: app.primaryGenreName,
              rating: app.averageUserRating,
              reviewCount: app.userRatingCount,
              url: app.trackViewUrl,
              lastUpdated: app.currentVersionReleaseDate
            })
          }
        }
      }

      console.log(`Found ${apps.length} relevant iOS apps`)
      return apps

    } catch (error) {
      console.error('Error searching iOS apps:', error)
      return []
    }
  }

  // 实时搜索 Android 应用
  async searchAndroidApps(companyName: string): Promise<AppInfo[]> {
    console.log(`Real-time searching Android apps for: ${companyName}`)
    
    try {
      // 策略1: 使用 Google Play Store 搜索页面
      const searchResults = await this.scrapeGooglePlaySearch(companyName)
      
      if (searchResults.length > 0) {
        console.log(`Found ${searchResults.length} Android apps via search scraping`)
        return searchResults
      }

      // 策略2: 使用第三方 API（如果可用）
      const apiResults = await this.searchViaThirdPartyAPI(companyName)
      
      if (apiResults.length > 0) {
        console.log(`Found ${apiResults.length} Android apps via third-party API`)
        return apiResults
      }

      // 策略3: 生成可能的包名并验证
      const generatedResults = await this.searchByGeneratedPackageNames(companyName)
      
      console.log(`Generated ${generatedResults.length} potential Android apps`)
      return generatedResults

    } catch (error) {
      console.error('Error searching Android apps:', error)
      return []
    }
  }

  // 策略1: 抓取 Google Play Store 搜索结果
  private async scrapeGooglePlaySearch(companyName: string): Promise<AppInfo[]> {
    const apps: AppInfo[] = []
    
    try {
      const searchQuery = encodeURIComponent(companyName)
      const searchUrl = `https://play.google.com/store/search?q=${searchQuery}&c=apps&hl=en&gl=US`
      
      console.log(`Scraping Google Play search: ${searchUrl}`)
      
      const response = await fetch(searchUrl, {
        headers: {
          'User-Agent': this.getRandomUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        }
      })

      if (!response.ok) {
        throw new Error(`Google Play search failed: ${response.status}`)
      }

      const html = await response.text()
      const extractedApps = this.extractAppsFromSearchHTML(html, companyName)
      
      // 为每个找到的应用获取详细信息
      for (const basicApp of extractedApps.slice(0, 10)) { // 限制为前10个
        try {
          const detailedApp = await this.getAppDetails(basicApp.packageId)
          if (detailedApp) {
            apps.push(detailedApp)
          }
          await this.delay(500) // 避免过于频繁的请求
        } catch (error) {
          console.error(`Error getting details for ${basicApp.packageId}:`, error)
          // 如果无法获取详细信息，使用基本信息
          apps.push(basicApp)
        }
      }

      return apps

    } catch (error) {
      console.error('Error scraping Google Play search:', error)
      return []
    }
  }

  // 从搜索页面HTML中提取应用信息
  private extractAppsFromSearchHTML(html: string, companyName: string): AppInfo[] {
    const apps: AppInfo[] = []
    
    try {
      // 查找应用包名的正则表达式
      const packageRegex = /\/store\/apps\/details\?id=([a-zA-Z0-9._]+)/g
      const packages = new Set<string>()
      
      let match
      while ((match = packageRegex.exec(html)) !== null) {
        packages.add(match[1])
      }

      // 查找应用名称的模式
      const titleRegex = /<span[^>]*>([^<]+)<\/span>/g
      const titles: string[] = []
      
      while ((match = titleRegex.exec(html)) !== null) {
        const title = match[1].trim()
        if (title.length > 2 && title.length < 100 && !title.includes('★')) {
          titles.push(title)
        }
      }

      // 查找开发者信息
      const developerRegex = /"([^"]*(?:Inc|LLC|Corp|Ltd|Studio|Games|App|Tech|Software)[^"]*)">/gi
      const developers: string[] = []
      
      while ((match = developerRegex.exec(html)) !== null) {
        developers.push(match[1])
      }

      // 组合信息创建应用对象
      let titleIndex = 0
      let developerIndex = 0
      
      for (const packageId of Array.from(packages).slice(0, 15)) {
        if (this.isRelevantPackage(packageId, companyName)) {
          const appName = titles[titleIndex] || this.generateAppNameFromPackage(packageId)
          const developer = developers[developerIndex] || companyName
          
          apps.push({
            id: packageId,
            name: appName,
            developer: developer,
            platform: 'android',
            packageId: packageId,
            url: `https://play.google.com/store/apps/details?id=${packageId}`,
            category: 'Unknown',
            rating: 0,
            reviewCount: 0
          })
          
          titleIndex = (titleIndex + 1) % titles.length
          developerIndex = (developerIndex + 1) % developers.length
        }
      }

      return apps

    } catch (error) {
      console.error('Error extracting apps from HTML:', error)
      return []
    }
  }

  // 获取应用详细信息
  private async getAppDetails(packageId: string): Promise<AppInfo | null> {
    try {
      const appUrl = `https://play.google.com/store/apps/details?id=${packageId}&hl=en&gl=US`
      
      const response = await fetch(appUrl, {
        headers: {
          'User-Agent': this.getRandomUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        }
      })

      if (!response.ok) {
        throw new Error(`App details fetch failed: ${response.status}`)
      }

      const html = await response.text()
      return this.parseAppDetailsFromHTML(html, packageId)

    } catch (error) {
      console.error(`Error getting app details for ${packageId}:`, error)
      return null
    }
  }

  // 从应用详情页面解析信息
  private parseAppDetailsFromHTML(html: string, packageId: string): AppInfo | null {
    try {
      // 提取应用名称
      const nameMatch = html.match(/<h1[^>]*><span[^>]*>([^<]+)<\/span><\/h1>/) ||
                       html.match(/<title>([^<]+) - Google Play 上的应用<\/title>/) ||
                       html.match(/<title>([^<]+) - Apps on Google Play<\/title>/)
      const name = nameMatch ? nameMatch[1].trim() : this.generateAppNameFromPackage(packageId)

      // 提取开发者
      const developerMatch = html.match(/开发者<\/div><div[^>]*><span[^>]*><a[^>]*>([^<]+)<\/a>/) ||
                            html.match(/Developer<\/div><div[^>]*><span[^>]*><a[^>]*>([^<]+)<\/a>/) ||
                            html.match(/"author":\s*"([^"]+)"/)
      const developer = developerMatch ? developerMatch[1].trim() : 'Unknown Developer'

      // 提取评分
      const ratingMatch = html.match(/(\d+\.?\d*)\s*star/) ||
                         html.match(/"ratingValue":\s*(\d+\.?\d*)/) ||
                         html.match(/评分.*?(\d+\.?\d*)/)
      const rating = ratingMatch ? parseFloat(ratingMatch[1]) : 0

      // 提取评论数
      const reviewMatch = html.match(/([\d,]+)\s*(?:reviews|条评价)/) ||
                         html.match(/"reviewCount":\s*(\d+)/) ||
                         html.match(/(\d+(?:,\d+)*)\s*个评分/)
      const reviewCount = reviewMatch ? parseInt(reviewMatch[1].replace(/,/g, '')) : 0

      // 提取分类
      const categoryMatch = html.match(/类别<\/div><div[^>]*><span[^>]*><a[^>]*>([^<]+)<\/a>/) ||
                           html.match(/Category<\/div><div[^>]*><span[^>]*><a[^>]*>([^<]+)<\/a>/) ||
                           html.match(/"genre":\s*"([^"]+)"/)
      const category = categoryMatch ? categoryMatch[1].trim() : 'Unknown'

      // 提取图标
      const iconMatch = html.match(/<img[^>]*src="([^"]*)"[^>]*alt="[^"]*图标"/) ||
                       html.match(/<img[^>]*alt="[^"]*icon"[^>]*src="([^"]*)"/) ||
                       html.match(/icon.*?src="([^"]*)"/)
      const iconUrl = iconMatch ? iconMatch[1] : undefined

      // 提取描述
      const descMatch = html.match(/<div[^>]*data-g-id="description"[^>]*>([^<]+)</) ||
                       html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/)
      const description = descMatch ? descMatch[1].trim() : undefined

      return {
        id: packageId,
        name,
        developer,
        platform: 'android',
        packageId,
        iconUrl,
        description,
        category,
        rating,
        reviewCount,
        url: `https://play.google.com/store/apps/details?id=${packageId}`
      }

    } catch (error) {
      console.error('Error parsing app details:', error)
      return null
    }
  }

  // 策略2: 使用第三方API（例如：42matters, AppTweak等的免费层）
  private async searchViaThirdPartyAPI(companyName: string): Promise<AppInfo[]> {
    // 这里可以集成第三方API，如：
    // - 42matters API
    // - AppTweak API
    // - SerpApi Google Play API
    // 由于需要API密钥，这里返回空数组
    return []
  }

  // 策略3: 生成可能的包名并验证
  private async searchByGeneratedPackageNames(companyName: string): Promise<AppInfo[]> {
    const apps: AppInfo[] = []
    const companyLower = companyName.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '')
    
    // 生成可能的包名模式
    const possiblePackages = [
      `com.${companyLower}`,
      `com.${companyLower}.android`,
      `com.${companyLower}.app`,
      `com.${companyLower}.mobile`,
      `${companyLower}.android`,
      `app.${companyLower}`,
      `co.${companyLower}`,
      `io.${companyLower}`,
      // 添加常见的变体
      `com.${companyLower}.main`,
      `com.${companyLower}.official`,
      `org.${companyLower}`,
    ]

    console.log(`Checking generated package names for ${companyName}:`, possiblePackages.slice(0, 5))

    // 验证每个包名是否存在
    for (const packageId of possiblePackages.slice(0, 8)) { // 限制检查数量
      try {
        const appDetails = await this.verifyPackageExists(packageId)
        if (appDetails) {
          apps.push(appDetails)
        }
        await this.delay(300) // 避免过于频繁的请求
      } catch (error) {
        console.error(`Error verifying package ${packageId}:`, error)
      }
    }

    return apps
  }

  // 验证包名是否存在并获取基本信息
  private async verifyPackageExists(packageId: string): Promise<AppInfo | null> {
    try {
      const appUrl = `https://play.google.com/store/apps/details?id=${packageId}&hl=en&gl=US`
      
      const response = await fetch(appUrl, {
        method: 'HEAD', // 只检查是否存在
        headers: {
          'User-Agent': this.getRandomUserAgent()
        }
      })

      if (response.ok) {
        // 如果应用存在，获取详细信息
        return await this.getAppDetails(packageId)
      }

      return null

    } catch (error) {
      return null
    }
  }

  // 从包名生成应用名称
  private generateAppNameFromPackage(packageId: string): string {
    const parts = packageId.split('.')
    const lastPart = parts[parts.length - 1]
    
    // 将驼峰命名转换为正常名称
    return lastPart
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
      .trim()
  }

  // 检查包名是否与公司相关
  private isRelevantPackage(packageId: string, companyName: string): boolean {
    const companyLower = companyName.toLowerCase().replace(/\s+/g, '')
    const packageLower = packageId.toLowerCase()
    
    return (
      packageLower.includes(companyLower) ||
      packageLower.includes(companyLower.substring(0, Math.max(4, companyLower.length - 2))) ||
      companyLower.includes(packageLower.split('.').pop() || '')
    )
  }

  // 检查应用是否与公司相关
  private isRelevantApp(app: any, companyName: string): boolean {
    const companyLower = companyName.toLowerCase()
    const appName = (app.trackName || '').toLowerCase()
    const developer = (app.artistName || '').toLowerCase()
    const description = (app.description || '').toLowerCase()

    return (
      developer.includes(companyLower) ||
      appName.includes(companyLower) ||
      description.includes(companyLower) ||
      this.checkNameVariants(companyLower, appName) ||
      this.checkNameVariants(companyLower, developer)
    )
  }

  // 检查名称变体
  private checkNameVariants(companyName: string, text: string): boolean {
    const cleanCompany = companyName
      .replace(/\s+(inc|corp|corporation|ltd|limited|llc|co)\b/gi, '')
      .trim()

    if (cleanCompany.length < 3) return false

    return (
      text.includes(cleanCompany) ||
      text.includes(cleanCompany.substring(0, Math.max(4, cleanCompany.length - 2)))
    )
  }

  // 生成搜索建议
  private generateSuggestions(companyName: string, foundApps: AppInfo[]): string[] {
    const suggestions: string[] = []
    
    if (foundApps.length === 0) {
      suggestions.push(`Try searching for "${companyName}" manually in app stores`)
      suggestions.push(`Check if the company name is spelled correctly`)
      suggestions.push(`The company might not have mobile apps`)
      suggestions.push(`Try variations like "${companyName} Inc" or "${companyName} LLC"`)
    } else if (foundApps.length === 1) {
      suggestions.push(`Only one app found. Consider if there are other apps from ${companyName}`)
    } else {
      suggestions.push(`Multiple apps found. Select the most relevant ones for analysis`)
      suggestions.push(`Consider analyzing each app separately for better insights`)
    }

    return suggestions
  }

  // 主搜索方法
  async searchApps(companyName: string): Promise<SearchResult> {
    console.log(`Starting real-time app search for: ${companyName}`)

    // 并行搜索 iOS 和 Android
    const [iosApps, androidApps] = await Promise.all([
      this.searchIOSApps(companyName),
      this.searchAndroidApps(companyName)
    ])

    const totalFound = iosApps.length + androidApps.length
    const suggestions = this.generateSuggestions(companyName, [...iosApps, ...androidApps])

    const result: SearchResult = {
      query: companyName,
      iosApps,
      androidApps,
      totalFound,
      suggestions
    }

    console.log(`Real-time search completed: ${totalFound} apps found (${iosApps.length} iOS, ${androidApps.length} Android)`)
    
    return result
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { companyName, reportId }: SearchAppsRequest = await req.json()

    if (!companyName) {
      return new Response(
        JSON.stringify({ error: 'Missing companyName' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    console.log(`Real-time app search request for: ${companyName}`)

    const searcher = new AppSearcher()
    const searchResult = await searcher.searchApps(companyName)

    // 如果提供了 reportId，可以保存搜索结果到数据库
    if (reportId) {
      try {
        const supabaseClient = createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        console.log(`Search results for report ${reportId} logged`)
      } catch (error) {
        console.error('Error saving search results:', error)
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        ...searchResult,
        timestamp: new Date().toISOString(),
        searchMethod: 'real-time'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in real-time app search:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Failed to search apps',
        details: error.message,
        iosApps: [],
        androidApps: [],
        totalFound: 0,
        suggestions: ['Please try again later or contact support']
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})