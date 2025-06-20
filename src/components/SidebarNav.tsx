import React from 'react'
import { motion } from 'framer-motion'
import { Theme } from '../stores/reportStore'

interface SidebarNavProps {
  themes: Theme[]
  onThemeClick: (index: number) => void
}

export const SidebarNav: React.FC<SidebarNavProps> = ({ themes, onThemeClick }) => {
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.6 }}
      className="sticky top-8 space-y-2"
    >
      <h3 className="text-lg font-semibold text-white mb-4">Themes</h3>
      <div className="space-y-1 max-h-96 overflow-y-auto">
        {themes.map((theme, index) => (
          <button
            key={theme.id}
            onClick={() => onThemeClick(index)}
            className="w-full text-left p-3 rounded-lg text-white/70 hover:text-white hover:bg-white/5 transition-all duration-200 text-sm"
          >
            <span className="text-[#2DD4BF] font-medium mr-2">
              {String(index + 1).padStart(2, '0')}
            </span>
            {theme.title}
          </button>
        ))}
      </div>
    </motion.div>
  )
}