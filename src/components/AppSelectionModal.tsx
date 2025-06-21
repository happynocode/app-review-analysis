import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Search, Smartphone, Apple, CheckCircle, ExternalLink, Star, Users, MessageCircle, ArrowRight, Calendar } from 'lucide-react'
import { Button } from './ui/Button'
import { LoadingSpinner } from './LoadingSpinner'

interface AppInfo {
  id: string
  name: string
  developer: string
  platform: 'ios' | 'android'
  packageId: string
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

interface AppSelectionModalProps {
  isOpen: boolean
  onClose: () => void
  companyName: string
  onAppsSelected: (selectedApps: AppInfo[], enabledPlatforms: string[], timeFilterDays: number) => void
  onRedditOnlySelected: () => void
}

export const AppSelectionModal: React.FC<AppSelectionModalProps> = ({
  isOpen,
  onClose,
  companyName,
  onAppsSelected,
  onRedditOnlySelected
}) => {
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null)
  const [selectedApps, setSelectedApps] = useState<Set<string>>(new Set())
  const [includeReddit, setIncludeReddit] = useState(true) // Reddit默认选中
  const [timeFilterDays, setTimeFilterDays] = useState(90) // 默认90天
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (isOpen && companyName) {
      searchApps()
      // 重置状态
      setSelectedApps(new Set())
      setIncludeReddit(true)
    }
  }, [isOpen, companyName])

  const searchApps = async () => {
    setLoading(true)
    setError('')
    
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/search-apps`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ companyName })
      })

      if (!response.ok) {
        throw new Error('Failed to search apps')
      }

      const result = await response.json()
      setSearchResult(result)
      
    } catch (err: any) {
      setError(err.message || 'Failed to search apps')
    } finally {
      setLoading(false)
    }
  }

  const toggleAppSelection = (appId: string) => {
    const newSelected = new Set(selectedApps)
    if (newSelected.has(appId)) {
      newSelected.delete(appId)
    } else {
      newSelected.add(appId)
    }
    setSelectedApps(newSelected)
  }

  const toggleRedditSelection = () => {
    setIncludeReddit(!includeReddit)
  }

  // 根据用户选择的应用自动推断启用的平台
  const getEnabledPlatforms = (): string[] => {
    const platforms: string[] = []
    
    // 如果选择了Reddit，添加reddit平台
    if (includeReddit) {
      platforms.push('reddit')
    }
    
    // 根据选择的应用推断平台
    if (searchResult && selectedApps.size > 0) {
      const allApps = [...searchResult.iosApps, ...searchResult.androidApps]
      const selected = allApps.filter(app => selectedApps.has(app.id))
      
      const hasIosApp = selected.some(app => app.platform === 'ios')
      const hasAndroidApp = selected.some(app => app.platform === 'android')
      
      if (hasIosApp && !platforms.includes('app_store')) {
        platforms.push('app_store')
      }
      if (hasAndroidApp && !platforms.includes('google_play')) {
        platforms.push('google_play')
      }
    }
    
    return platforms
  }

  const getSelectedAppsInfo = () => {
    if (!searchResult || selectedApps.size === 0) return null
    
    const allApps = [...searchResult.iosApps, ...searchResult.androidApps]
    const selected = allApps.filter(app => selectedApps.has(app.id))
    
    const iosCount = selected.filter(app => app.platform === 'ios').length
    const androidCount = selected.filter(app => app.platform === 'android').length
    
    return { selected, iosCount, androidCount }
  }

  const handleConfirmSelection = () => {
    const enabledPlatforms = getEnabledPlatforms()
    
    if (enabledPlatforms.length === 0) {
      alert('Please select at least one option (Reddit or specific apps)')
      return
    }
    
    if (searchResult) {
      const allApps = [...searchResult.iosApps, ...searchResult.androidApps]
      const selected = allApps.filter(app => selectedApps.has(app.id))
      onAppsSelected(selected, enabledPlatforms, timeFilterDays)
    }
    onClose()
  }

  const AppCard: React.FC<{ app: AppInfo }> = ({ app }) => {
    const isSelected = selectedApps.has(app.id)
    
    // Ensure meaningful app name display
    const displayName = app.name || app.packageId.split('.').pop() || app.packageId
    const displayDeveloper = app.developer || 'Unknown Developer'
    const displayCategory = app.category || 'Unknown'
    const displayRating = app.rating || 0
    const displayReviewCount = app.reviewCount || 0
    
    return (
      <motion.div
        layout
        className={`relative p-4 rounded-xl border-2 cursor-pointer transition-all duration-200 ${
          isSelected 
            ? 'border-[#2DD4BF] bg-[#2DD4BF]/10' 
            : 'border-white/20 bg-white/5 hover:border-white/40'
        }`}
        onClick={() => toggleAppSelection(app.id)}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        {isSelected && (
          <div className="absolute top-2 right-2">
            <CheckCircle className="w-5 h-5 text-[#2DD4BF]" />
          </div>
        )}
        
        <div className="flex items-start space-x-3">
          {app.iconUrl ? (
            <img 
              src={app.iconUrl} 
              alt={displayName}
              className="w-12 h-12 rounded-xl"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
            />
          ) : (
            <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center">
              {app.platform === 'ios' ? (
                <Apple className="w-6 h-6 text-white" />
              ) : (
                <Smartphone className="w-6 h-6 text-white" />
              )}
            </div>
          )}
          
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-white truncate">{displayName}</h3>
            <p className="text-sm text-white/60 truncate">{displayDeveloper}</p>
            
            <div className="flex items-center space-x-4 mt-2 text-xs text-white/50">
              <div className="flex items-center">
                {app.platform === 'ios' ? (
                  <Apple className="w-3 h-3 mr-1" />
                ) : (
                  <Smartphone className="w-3 h-3 mr-1" />
                )}
                {app.platform === 'ios' ? 'iOS' : 'Android'}
              </div>
              
              {displayRating > 0 && (
                <div className="flex items-center">
                  <Star className="w-3 h-3 mr-1 fill-current" />
                  {displayRating.toFixed(1)}
                </div>
              )}
              
              {displayReviewCount > 0 && (
                <div className="flex items-center">
                  <Users className="w-3 h-3 mr-1" />
                  {displayReviewCount.toLocaleString()}
                </div>
              )}
            </div>
            
            {displayCategory && displayCategory !== 'Unknown' && (
              <span className="inline-block mt-2 px-2 py-1 text-xs bg-white/10 rounded-full text-white/70">
                {displayCategory}
              </span>
            )}
          </div>
        </div>
        
        {app.description && (
          <p className="mt-3 text-sm text-white/70 line-clamp-2">
            {app.description}
          </p>
        )}

        {/* Show package ID for debugging */}
        <div className="mt-2 text-xs text-white/40">
          {app.packageId}
        </div>
      </motion.div>
    )
  }

  if (!isOpen) return null

  const selectedAppsInfo = getSelectedAppsInfo()
  const enabledPlatforms = getEnabledPlatforms()

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        />
        
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative bg-[#0A1128] border border-white/20 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-white/10">
            <div>
              <h2 className="text-xl font-semibold text-white">Select Analysis Options</h2>
              <p className="text-white/60 mt-1">
                Choose what to analyze for <span className="text-[#2DD4BF] font-medium">{companyName}</span>
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-white/60 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-center">
                  <div className="w-8 h-8 border-2 border-[#2DD4BF] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                  <p className="text-white/70">Searching for apps...</p>
                </div>
              </div>
            ) : error ? (
              <div className="text-center py-12">
                <div className="text-red-400 mb-4">Search Failed</div>
                <p className="text-white/60 mb-4">{error}</p>
                <Button onClick={searchApps} variant="secondary">
                  Retry
                </Button>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Time Filter Settings */}
                <div className="bg-white/5 border border-white/10 rounded-xl p-6">
                  <h3 className="text-lg font-semibold text-white mb-4 flex items-center">
                    <Calendar className="w-5 h-5 mr-2" />
                    Time Filter Settings
                  </h3>
                  <p className="text-white/60 text-sm mb-4">
                    Set how far back in time to analyze reviews and discussions
                  </p>
                  
                  <div className="flex items-center space-x-4">
                    <label className="text-white font-medium">
                      Analyze reviews from the past:
                    </label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="number"
                        min="1"
                        max="365"
                        value={timeFilterDays}
                        onChange={(e) => setTimeFilterDays(Math.max(1, Math.min(365, parseInt(e.target.value) || 90)))}
                        className="w-20 px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white text-center focus:outline-none focus:border-[#2DD4BF] focus:bg-white/20"
                      />
                      <span className="text-white/70">days</span>
                    </div>
                  </div>
                  
                  <div className="mt-3 flex space-x-2">
                    <button
                      onClick={() => setTimeFilterDays(30)}
                      className={`px-3 py-1 rounded-full text-sm transition-colors ${
                        timeFilterDays === 30 
                          ? 'bg-[#2DD4BF]/20 text-[#2DD4BF] border border-[#2DD4BF]/50' 
                          : 'bg-white/10 text-white/60 border border-white/20 hover:bg-white/20'
                      }`}
                    >
                      30 days
                    </button>
                    <button
                      onClick={() => setTimeFilterDays(90)}
                      className={`px-3 py-1 rounded-full text-sm transition-colors ${
                        timeFilterDays === 90 
                          ? 'bg-[#2DD4BF]/20 text-[#2DD4BF] border border-[#2DD4BF]/50' 
                          : 'bg-white/10 text-white/60 border border-white/20 hover:bg-white/20'
                      }`}
                    >
                      90 days
                    </button>
                    <button
                      onClick={() => setTimeFilterDays(180)}
                      className={`px-3 py-1 rounded-full text-sm transition-colors ${
                        timeFilterDays === 180 
                          ? 'bg-[#2DD4BF]/20 text-[#2DD4BF] border border-[#2DD4BF]/50' 
                          : 'bg-white/10 text-white/60 border border-white/20 hover:bg-white/20'
                      }`}
                    >
                      6 months
                    </button>
                    <button
                      onClick={() => setTimeFilterDays(365)}
                      className={`px-3 py-1 rounded-full text-sm transition-colors ${
                        timeFilterDays === 365 
                          ? 'bg-[#2DD4BF]/20 text-[#2DD4BF] border border-[#2DD4BF]/50' 
                          : 'bg-white/10 text-white/60 border border-white/20 hover:bg-white/20'
                      }`}
                    >
                      1 year
                    </button>
                  </div>
                </div>

                {/* Reddit Option */}
                <div className="bg-white/5 border border-white/10 rounded-xl p-6">
                  <h3 className="text-lg font-semibold text-white mb-4">
                    Social Media Analysis
                  </h3>
                  <p className="text-white/60 text-sm mb-4">
                    Analyze community discussions and user experiences from Reddit
                  </p>
                  
                  <motion.div
                    className={`flex items-center justify-between p-4 rounded-lg border cursor-pointer transition-all duration-200 ${
                      includeReddit 
                        ? 'border-[#2DD4BF]/50 bg-[#2DD4BF]/10' 
                        : 'border-white/20 bg-white/5 hover:border-white/30'
                    }`}
                    onClick={toggleRedditSelection}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                  >
                    <div className="flex items-center space-x-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                        includeReddit ? 'bg-orange-500/20' : 'bg-white/10'
                      }`}>
                        <MessageCircle className={`w-5 h-5 ${includeReddit ? 'text-orange-400' : 'text-white/60'}`} />
                      </div>
                      <div>
                        <h4 className="font-medium text-white">Reddit Discussions</h4>
                        <p className="text-sm text-white/60">Community feedback and discussions</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center">
                      {includeReddit && (
                        <CheckCircle className="w-6 h-6 text-[#2DD4BF]" />
                      )}
                    </div>
                  </motion.div>
                </div>

                {/* App Selection Section */}
                {searchResult && (
                  <>
                    <div className="border-t border-white/10 pt-6">
                      <h3 className="text-lg font-semibold text-white mb-4">
                        Mobile Apps Analysis
                      </h3>
                      <p className="text-white/60 text-sm mb-6">
                        Select specific iOS and Android apps to analyze app store reviews and user feedback
                      </p>
                    </div>

                    {/* iOS Apps */}
                    {searchResult.iosApps.length > 0 && (
                      <div>
                        <div className="flex items-center mb-4">
                          <Apple className="w-5 h-5 text-white mr-2" />
                          <h3 className="text-lg font-medium text-white">
                            iOS Apps ({searchResult.iosApps.length})
                          </h3>
                        </div>
                        <div className="grid gap-4">
                          {searchResult.iosApps.map(app => (
                            <AppCard key={app.id} app={app} />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Android Apps */}
                    {searchResult.androidApps.length > 0 && (
                      <div>
                        <div className="flex items-center mb-4">
                          <Smartphone className="w-5 h-5 text-white mr-2" />
                          <h3 className="text-lg font-medium text-white">
                            Android Apps ({searchResult.androidApps.length})
                          </h3>
                        </div>
                        <div className="grid gap-4">
                          {searchResult.androidApps.map(app => (
                            <AppCard key={app.id} app={app} />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* No Apps Found */}
                    {searchResult.totalFound === 0 && (
                      <div className="text-center py-8 border border-white/10 rounded-xl">
                        <Search className="w-12 h-12 text-white/20 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-white mb-2">No Apps Found</h3>
                        <p className="text-white/60 mb-4">
                          No mobile apps found for "{companyName}"
                        </p>
                        <p className="text-white/50 text-sm mb-4">
                          You can still analyze Reddit discussions using the option above.
                        </p>
                        <div className="space-y-2 text-sm text-white/50">
                          {searchResult.suggestions.map((suggestion, index) => (
                            <p key={index}>• {suggestion}</p>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Selection Summary */}
                {enabledPlatforms.length > 0 && (
                  <div className="bg-[#2DD4BF]/10 border border-[#2DD4BF]/20 rounded-xl p-4">
                    <h4 className="text-white font-medium mb-2">Analysis Summary</h4>
                    <div className="space-y-2 text-sm">
                      {includeReddit && (
                        <div className="flex items-center">
                          <MessageCircle className="w-4 h-4 text-orange-400 mr-2" />
                          <span className="text-white">Reddit discussions and community feedback</span>
                        </div>
                      )}
                      
                      {selectedAppsInfo && selectedAppsInfo.iosCount > 0 && (
                        <div className="flex items-center">
                          <Apple className="w-4 h-4 text-blue-400 mr-2" />
                          <span className="text-white">
                            {selectedAppsInfo.iosCount} iOS app{selectedAppsInfo.iosCount > 1 ? 's' : ''} 
                            <span className="text-white/60"> (App Store reviews)</span>
                          </span>
                        </div>
                      )}
                      
                      {selectedAppsInfo && selectedAppsInfo.androidCount > 0 && (
                        <div className="flex items-center">
                          <Smartphone className="w-4 h-4 text-green-400 mr-2" />
                          <span className="text-white">
                            {selectedAppsInfo.androidCount} Android app{selectedAppsInfo.androidCount > 1 ? 's' : ''} 
                            <span className="text-white/60"> (Google Play reviews)</span>
                          </span>
                        </div>
                      )}
                      
                      <div className="mt-3 pt-2 border-t border-white/10">
                        <p className="text-[#2DD4BF] text-sm">
                          ✓ Will analyze {enabledPlatforms.length} platform{enabledPlatforms.length > 1 ? 's' : ''}: {
                            enabledPlatforms.map(p => 
                              p === 'reddit' ? 'Reddit' : 
                              p === 'app_store' ? 'App Store' : 
                              p === 'google_play' ? 'Google Play' : p
                            ).join(', ')
                          }
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between p-6 border-t border-white/10">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <div className="flex space-x-3">
              {enabledPlatforms.length > 0 && (
                <Button 
                  variant="secondary" 
                  onClick={() => {
                    setSelectedApps(new Set())
                    setIncludeReddit(true)
                  }}
                >
                  Reset Selection
                </Button>
              )}
              {enabledPlatforms.length > 0 && (
                <Button 
                  onClick={handleConfirmSelection}
                  icon={ArrowRight}
                >
                  Start Analysis
                  {selectedApps.size > 0 && (
                    <span className="ml-1">({selectedApps.size} apps)</span>
                  )}
                </Button>
              )}
              {enabledPlatforms.length === 0 && (
                <Button 
                  disabled
                  variant="secondary"
                >
                  Select at least one option
                </Button>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}