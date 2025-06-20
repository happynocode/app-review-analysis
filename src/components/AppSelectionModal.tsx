import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Search, Smartphone, Apple, CheckCircle, ExternalLink, Star, Users } from 'lucide-react'
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
  onAppsSelected: (selectedApps: AppInfo[]) => void
}

export const AppSelectionModal: React.FC<AppSelectionModalProps> = ({
  isOpen,
  onClose,
  companyName,
  onAppsSelected
}) => {
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null)
  const [selectedApps, setSelectedApps] = useState<Set<string>>(new Set())
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
      
      // Auto-select the most relevant apps
      if (result.totalFound > 0) {
        const autoSelected = new Set<string>()
        
        // Select top-rated iOS apps
        if (result.iosApps.length > 0) {
          const topIOS = result.iosApps
            .sort((a, b) => (b.rating || 0) - (a.rating || 0))
            .slice(0, 2)
          topIOS.forEach(app => autoSelected.add(app.id))
        }
        
        // Select top-rated Android apps
        if (result.androidApps.length > 0) {
          const topAndroid = result.androidApps
            .sort((a, b) => (b.rating || 0) - (a.rating || 0))
            .slice(0, 2)
          topAndroid.forEach(app => autoSelected.add(app.id))
        }
        
        setSelectedApps(autoSelected)
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

  const handleConfirmSelection = () => {
    if (searchResult) {
      const allApps = [...searchResult.iosApps, ...searchResult.androidApps]
      const selected = allApps.filter(app => selectedApps.has(app.id))
      onAppsSelected(selected)
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
              <h2 className="text-xl font-semibold text-white">Select Apps to Analyze</h2>
              <p className="text-white/60 mt-1">
                Found multiple apps for <span className="text-[#2DD4BF] font-medium">{companyName}</span>
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
            ) : searchResult ? (
              <div className="space-y-6">
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

                {/* No Results */}
                {searchResult.totalFound === 0 && (
                  <div className="text-center py-12">
                    <Search className="w-16 h-16 text-white/20 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-white mb-2">No Apps Found</h3>
                    <p className="text-white/60 mb-6">
                      No apps found related to "{companyName}"
                    </p>
                    <div className="space-y-2 text-sm text-white/50">
                      {searchResult.suggestions.map((suggestion, index) => (
                        <p key={index}>• {suggestion}</p>
                      ))}
                    </div>
                  </div>
                )}

                {/* Selection Summary */}
                {selectedApps.size > 0 && (
                  <div className="bg-[#2DD4BF]/10 border border-[#2DD4BF]/20 rounded-xl p-4">
                    <p className="text-white">
                      Selected <span className="font-semibold text-[#2DD4BF]">{selectedApps.size}</span> apps for analysis
                    </p>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between p-6 border-t border-white/10">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <div className="flex space-x-3">
              {searchResult && searchResult.totalFound > 0 && (
                <Button 
                  variant="secondary" 
                  onClick={() => setSelectedApps(new Set())}
                  disabled={selectedApps.size === 0}
                >
                  Clear Selection
                </Button>
              )}
              <Button 
                onClick={handleConfirmSelection}
                disabled={selectedApps.size === 0}
              >
                Analyze Selected Apps ({selectedApps.size})
              </Button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}