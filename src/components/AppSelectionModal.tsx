import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Search, Smartphone, Apple, CheckCircle, ExternalLink, Star, Users, MessageCircle, ArrowRight, ToggleLeft, ToggleRight } from 'lucide-react'
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

interface PlatformSelection {
  ios: boolean
  android: boolean
  reddit: boolean
}

interface AppSelectionModalProps {
  isOpen: boolean
  onClose: () => void
  companyName: string
  onAppsSelected: (selectedApps: AppInfo[], enabledPlatforms: string[]) => void
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
  const [platformSelection, setPlatformSelection] = useState<PlatformSelection>({
    ios: false,
    android: false,
    reddit: true // Reddit默认开启，因为它不依赖于特定应用
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (isOpen && companyName) {
      searchApps()
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
      
      // 智能默认选择平台和应用
      if (result.totalFound > 0) {
        const autoSelected = new Set<string>()
        const smartPlatforms = {
          ios: false,
          android: false,
          reddit: true // Reddit始终默认开启
        }
        
        // 如果找到iOS应用，自动选择iOS平台和顶级应用
        if (result.iosApps.length > 0) {
          smartPlatforms.ios = true
          const topIOS = result.iosApps
            .sort((a: AppInfo, b: AppInfo) => (b.rating || 0) - (a.rating || 0))
            .slice(0, 2)
          topIOS.forEach((app: AppInfo) => autoSelected.add(app.id))
        }
        
        // 如果找到Android应用，自动选择Android平台和顶级应用
        if (result.androidApps.length > 0) {
          smartPlatforms.android = true
          const topAndroid = result.androidApps
            .sort((a: AppInfo, b: AppInfo) => (b.rating || 0) - (a.rating || 0))
            .slice(0, 2)
          topAndroid.forEach((app: AppInfo) => autoSelected.add(app.id))
        }
        
        setSelectedApps(autoSelected)
        setPlatformSelection(smartPlatforms)
      }
      
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

  const togglePlatform = (platform: keyof PlatformSelection) => {
    setPlatformSelection(prev => ({
      ...prev,
      [platform]: !prev[platform]
    }))
  }

  const getEnabledPlatforms = (): string[] => {
    const platforms: string[] = []
    if (platformSelection.ios) platforms.push('app_store')
    if (platformSelection.android) platforms.push('google_play')
    if (platformSelection.reddit) platforms.push('reddit')
    return platforms
  }

  const getSelectedPlatformCount = (): number => {
    return Object.values(platformSelection).filter(Boolean).length
  }

  const handleConfirmSelection = () => {
    if (searchResult) {
      const allApps = [...searchResult.iosApps, ...searchResult.androidApps]
      const selected = allApps.filter(app => selectedApps.has(app.id))
      const enabledPlatforms = getEnabledPlatforms()
      
      if (enabledPlatforms.length === 0) {
        alert('Please select at least one platform for analysis')
        return
      }
      
      onAppsSelected(selected, enabledPlatforms)
    }
    onClose()
  }

  // Deprecated - Reddit is now selected via platform toggles
  const handleRedditOnly = () => {
    // No longer used - kept for compatibility
  }

  const PlatformToggle: React.FC<{
    platform: keyof PlatformSelection
    label: string
    icon: React.ComponentType<any>
    description: string
    disabled?: boolean
    disabledReason?: string
  }> = ({ platform, label, icon: Icon, description, disabled = false, disabledReason }) => {
    const isEnabled = platformSelection[platform]
    
    return (
      <div className={`flex items-center justify-between p-4 rounded-lg border ${
        disabled 
          ? 'border-white/10 bg-white/5 opacity-50' 
          : isEnabled 
            ? 'border-[#2DD4BF]/50 bg-[#2DD4BF]/10' 
            : 'border-white/20 bg-white/5 hover:border-white/30'
      } transition-all duration-200`}>
        <div className="flex items-center space-x-3">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
            disabled 
              ? 'bg-white/5' 
              : isEnabled 
                ? 'bg-[#2DD4BF]/20' 
                : 'bg-white/10'
          }`}>
            <Icon className={`w-5 h-5 ${
              disabled 
                ? 'text-white/30' 
                : isEnabled 
                  ? 'text-[#2DD4BF]' 
                  : 'text-white/60'
            }`} />
          </div>
          <div>
            <h4 className={`font-medium ${disabled ? 'text-white/30' : 'text-white'}`}>
              {label}
            </h4>
            <p className={`text-sm ${disabled ? 'text-white/20' : 'text-white/60'}`}>
              {disabled && disabledReason ? disabledReason : description}
            </p>
          </div>
        </div>
        
        <button
          onClick={() => !disabled && togglePlatform(platform)}
          disabled={disabled}
          className={`flex items-center ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
        >
          {isEnabled ? (
            <ToggleRight className={`w-8 h-8 ${disabled ? 'text-white/20' : 'text-[#2DD4BF]'}`} />
          ) : (
            <ToggleLeft className={`w-8 h-8 ${disabled ? 'text-white/20' : 'text-white/40'}`} />
          )}
        </button>
      </div>
    )
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
              <h2 className="text-xl font-semibold text-white">Select Analysis Type</h2>
              <p className="text-white/60 mt-1">
                Choose apps to analyze or analyze Reddit discussions only for <span className="text-[#2DD4BF] font-medium">{companyName}</span>
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

                                {/* Platform Selection */}
                <div className="bg-white/5 border border-white/10 rounded-xl p-6">
                  <h3 className="text-lg font-semibold text-white mb-4">
                    Select Platforms to Analyze
                        </h3>
                  <p className="text-white/60 text-sm mb-6">
                    Choose which platforms to analyze for "{companyName}". You can mix and match different platforms based on your needs.
                  </p>
                  
                  <div className="grid gap-4">
                    <PlatformToggle
                      platform="ios"
                      label="iOS App Store"
                      icon={Apple}
                      description={searchResult && searchResult.iosApps.length > 0 
                        ? `${searchResult.iosApps.length} iOS apps found`
                        : "No iOS apps found"
                      }
                      disabled={searchResult ? searchResult.iosApps.length === 0 : false}
                      disabledReason="No iOS apps found for this search"
                    />
                    <PlatformToggle
                      platform="android"
                      label="Google Play Store"
                      icon={Smartphone}
                      description={searchResult && searchResult.androidApps.length > 0 
                        ? `${searchResult.androidApps.length} Android apps found`
                        : "No Android apps found"
                      }
                      disabled={searchResult ? searchResult.androidApps.length === 0 : false}
                      disabledReason="No Android apps found for this search"
                    />
                    <PlatformToggle
                      platform="reddit"
                      label="Reddit Discussions"
                      icon={MessageCircle}
                      description="Community discussions and user experiences"
                    />
                        </div>
                  
                  {getSelectedPlatformCount() > 0 && (
                    <div className="mt-4 p-3 bg-[#2DD4BF]/10 border border-[#2DD4BF]/20 rounded-lg">
                      <p className="text-sm text-[#2DD4BF]">
                        ✓ {getSelectedPlatformCount()} platform{getSelectedPlatformCount() > 1 ? 's' : ''} selected
                      </p>
                    </div>
                  )}
                </div>

                {/* App Selection Section */}
                {searchResult && searchResult.totalFound > 0 && (
                  <div className="border-t border-white/10 pt-6">
                    <h3 className="text-lg font-semibold text-white mb-4">
                      Select Specific Apps (Optional)
                    </h3>
                    <p className="text-white/60 text-sm mb-6">
                      Choose specific apps to focus the analysis on. If no apps are selected, we'll analyze all available apps on the enabled platforms.
                    </p>
                  </div>
                )}

                {/* App Selection Section */}
                {searchResult && (
                  <>
                    <div className="border-t border-white/10 pt-6">
                      <h3 className="text-lg font-semibold text-white mb-4">
                        Or Select Specific Apps to Analyze
                      </h3>
                      <p className="text-white/60 text-sm mb-6">
                        Choose specific iOS and Android apps for comprehensive analysis including app store reviews and Reddit discussions.
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

                    {/* Selection Summary */}
                    {(selectedApps.size > 0 || getSelectedPlatformCount() > 0) && (
                      <div className="bg-[#2DD4BF]/10 border border-[#2DD4BF]/20 rounded-xl p-4">
                        <div className="space-y-2">
                          {getSelectedPlatformCount() > 0 && (
                            <p className="text-white text-sm">
                              <span className="font-semibold text-[#2DD4BF]">{getSelectedPlatformCount()}</span> platform{getSelectedPlatformCount() > 1 ? 's' : ''} selected: {
                                Object.entries(platformSelection)
                                  .filter(([_, enabled]) => enabled)
                                  .map(([platform, _]) => platform === 'ios' ? 'iOS' : platform === 'android' ? 'Android' : 'Reddit')
                                  .join(', ')
                              }
                            </p>
                          )}
                          {selectedApps.size > 0 && (
                            <p className="text-white text-sm">
                              <span className="font-semibold text-[#2DD4BF]">{selectedApps.size}</span> specific app{selectedApps.size > 1 ? 's' : ''} selected
                            </p>
                          )}
                          {selectedApps.size === 0 && getSelectedPlatformCount() > 0 && (
                            <p className="text-white/60 text-xs">
                              Will analyze all available apps on selected platforms
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </>
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
              {(selectedApps.size > 0 || getSelectedPlatformCount() > 0) && (
                <Button 
                  variant="secondary" 
                  onClick={() => {
                    setSelectedApps(new Set())
                    setPlatformSelection({ ios: false, android: false, reddit: true })
                  }}
                >
                  Reset Selection
                </Button>
              )}
              {getSelectedPlatformCount() > 0 && (
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
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}