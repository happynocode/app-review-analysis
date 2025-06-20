import React from 'react'
import { motion } from 'framer-motion'

interface CardProps {
  children: React.ReactNode
  className?: string
  hover?: boolean
}

export const Card: React.FC<CardProps> = ({ 
  children, 
  className = '', 
  hover = false 
}) => {
  const Component = hover ? motion.div : 'div'
  const motionProps = hover ? {
    whileHover: { scale: 1.02, y: -2 },
    transition: { duration: 0.2 }
  } : {}

  return (
    <Component
      className={`bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6 shadow-lg ${className}`}
      {...motionProps}
    >
      {children}
    </Component>
  )
}