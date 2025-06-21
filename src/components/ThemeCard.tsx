import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, Quote, Lightbulb } from 'lucide-react'
import { Theme } from '../stores/reportStore'
import { Card } from './ui/Card'

interface ThemeCardProps {
  theme: Theme
  index: number
}

export const ThemeCard: React.FC<ThemeCardProps> = ({ theme, index }) => {
  const [isExpanded, setIsExpanded] = useState(false)

  // 获取平台显示信息
  const getPlatformInfo = (platform: string) => {
    switch (platform) {
      case 'reddit':
        return { name: 'Reddit', color: 'bg-orange-500', textColor: 'text-orange-100' }
      case 'app_store':
        return { name: 'App Store', color: 'bg-blue-500', textColor: 'text-blue-100' }
      case 'google_play':
        return { name: 'Google Play', color: 'bg-green-500', textColor: 'text-green-100' }
      default:
        return { name: 'Unknown', color: 'bg-gray-500', textColor: 'text-gray-100' }
    }
  }

  const platformInfo = theme.platform ? getPlatformInfo(theme.platform) : null

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.1 }}
    >
      <Card className="p-6 bg-white/10 backdrop-blur-sm border-white/20 hover:bg-white/15 transition-all duration-300 cursor-pointer">
        <div
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-start justify-between"
        >
          <div className="flex-1">
            <div className="flex items-center mb-2">
              <h3 className="text-xl font-semibold text-white mr-3">
                {theme.title}
              </h3>
              {platformInfo && (
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${platformInfo.color} ${platformInfo.textColor}`}>
                  {platformInfo.name}
                </span>
              )}
            </div>
            <p className="text-white/70 leading-relaxed">
              {theme.description}
            </p>
          </div>
          <motion.div
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            className="ml-4 mt-1"
          >
            <ChevronDown className="w-5 h-5 text-white/60" />
          </motion.div>
        </div>

        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3 }}
              className="mt-6 space-y-6 overflow-hidden"
            >
              {/* Quotes Section */}
              {theme.quotes.length > 0 && (
                <div>
                  <div className="flex items-center mb-4">
                    <Quote className="w-5 h-5 text-[#2DD4BF] mr-2" />
                    <h4 className="text-lg font-medium text-white">User Reviews</h4>
                  </div>
                  <div className="space-y-4">
                    {theme.quotes.slice(0, 2).map((quote) => (
                      <div
                        key={quote.id}
                        className="bg-white/5 rounded-xl p-4 border-l-4 border-[#2DD4BF]"
                      >
                        <p className="text-white/80 italic">"{quote.text}"</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Suggestions Section */}
              {theme.suggestions.length > 0 && (
                <div>
                  <div className="flex items-center mb-4">
                    <Lightbulb className="w-5 h-5 text-[#2DD4BF] mr-2" />
                    <h4 className="text-lg font-medium text-white">Product Suggestions</h4>
                  </div>
                  <ul className="space-y-2">
                    {theme.suggestions.map((suggestion) => (
                      <li
                        key={suggestion.id}
                        className="flex items-start text-white/80"
                      >
                        <span className="w-2 h-2 bg-[#2DD4BF] rounded-full mt-2 mr-3 flex-shrink-0" />
                        <span>{suggestion.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </motion.div>
  )
}