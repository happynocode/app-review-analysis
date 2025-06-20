import React from 'react'
import { motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'

interface LoadingSpinnerProps {
  message?: string
  progress?: number
  size?: 'sm' | 'md' | 'lg'
  inline?: boolean
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ 
  message = 'Generating report...', 
  progress,
  size = 'md',
  inline = false
}) => {
  const getSizeClasses = () => {
    switch (size) {
      case 'sm': return 'w-4 h-4'
      case 'lg': return 'w-20 h-20'
      default: return 'w-16 h-16'
    }
  }

  const containerClass = inline 
    ? "flex items-center justify-center" 
    : "fixed inset-0 bg-[#0A1128]/90 backdrop-blur-sm flex items-center justify-center z-50"

  return (
    <div className={containerClass}>
      <div className="text-center space-y-6">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          className={`${getSizeClasses()} mx-auto`}
        >
          <Sparkles className={`${getSizeClasses()} text-[#2DD4BF]`} />
        </motion.div>
        
        <div className="space-y-2">
          <h3 className="text-xl font-semibold text-white">{message}</h3>
          {progress !== undefined && (
            <div className="w-64 mx-auto">
              <div className="bg-white/10 rounded-full h-2 overflow-hidden">
                <motion.div
                  className="bg-[#2DD4BF] h-full rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.5 }}
                />
              </div>
              <p className="text-white/60 text-sm mt-2">{progress}% complete</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}