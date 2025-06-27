import React from 'react'
import { motion } from 'framer-motion'
import { DivideIcon as LucideIcon } from 'lucide-react'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  icon?: LucideIcon
  loading?: boolean
  children: React.ReactNode
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  loading = false,
  children,
  className = '',
  disabled,
  ...props
}) => {
  const baseClasses = 'inline-flex items-center justify-center font-medium rounded-xl transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[#2DD4BF] focus:ring-offset-2 focus:ring-offset-[#0A1128] disabled:opacity-50 disabled:cursor-not-allowed'
  
  const variants = {
    primary: 'bg-[#2DD4BF] text-[#0A1128] hover:bg-[#14B8A6] shadow-lg shadow-[#2DD4BF]/20',
    secondary: 'bg-white/10 text-white hover:bg-white/20 backdrop-blur-sm border border-white/20',
    ghost: 'text-[#2DD4BF] hover:bg-[#2DD4BF]/10'
  }
  
  const sizes = {
    sm: 'px-3 py-2 text-sm min-h-[36px]',
    md: 'px-4 sm:px-6 py-3 text-base min-h-[44px]',
    lg: 'px-6 sm:px-8 py-3 sm:py-4 text-base sm:text-lg min-h-[48px]'
  }

  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className={`${baseClasses} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
      ) : Icon ? (
        <Icon className="w-5 h-5 mr-2" />
      ) : null}
      {children}
    </motion.button>
  )
}