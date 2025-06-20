import React, { useState } from 'react'
import { Search, Sparkles } from 'lucide-react'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { motion } from 'framer-motion'

interface SearchBarProps {
  onGenerate: (appName: string) => void
  loading?: boolean
}

export const SearchBar: React.FC<SearchBarProps> = ({ onGenerate, loading }) => {
  const [appName, setAppName] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (appName.trim()) {
      onGenerate(appName.trim())
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
      className="w-full max-w-2xl mx-auto"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-white/50 w-5 h-5" />
          <Input
            type="text"
            placeholder="Enter app or company name (e.g., Instagram, Spotify, Uber)"
            value={appName}
            onChange={(e) => setAppName(e.target.value)}
            className="pl-12 text-lg py-4"
            disabled={loading}
          />
        </div>
        <Button
          type="submit"
          size="lg"
          icon={Sparkles}
          loading={loading}
          disabled={!appName.trim() || loading}
          className="w-full"
        >
          {loading ? 'Generating Report...' : 'Generate Report'}
        </Button>
      </form>
      
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.6 }}
        className="mt-6 text-center"
      >
        <p className="text-white/60 text-sm">
          Get insights from App Store, Google Play, Reddit, and more in under 60 seconds
        </p>
      </motion.div>
    </motion.div>
  )
}