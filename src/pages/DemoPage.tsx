import React from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { BarChart3, User, LogOut } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { useAuthStore } from '../stores/authStore'

export const DemoPage: React.FC = () => {
  const navigate = useNavigate()
  const { user, signOut } = useAuthStore()

  const handleSignOut = async () => {
    await signOut()
    navigate('/')
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0A1128] via-[#0F1B3C] to-[#0A1128] flex items-center justify-center">
        <Card className="p-8 text-center">
          <h2 className="text-2xl font-bold text-white mb-4">Please Sign In</h2>
          <p className="text-white/70 mb-6">You need to sign in to view user pages</p>
          <Button onClick={() => navigate('/')}>
            Back to Home
          </Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0A1128] via-[#0F1B3C] to-[#0A1128]">
      {/* Header */}
      <header className="border-b border-white/10 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center space-x-2"
          >
            <BarChart3 className="w-8 h-8 text-[#2DD4BF]" />
            <span className="text-xl font-bold text-white">ReviewInsight</span>
          </motion.div>
          
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2 text-white/70">
              <User className="w-4 h-4" />
              <span>{user.email}</span>
            </div>
            <Button variant="ghost" onClick={handleSignOut} icon={LogOut}>
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center"
        >
          <Card className="p-12">
            <h1 className="text-4xl font-bold text-white mb-6">Demo Page</h1>
            <p className="text-white/70 text-lg mb-8">
              This is a demo page. To see real functionality, please use the main application.
            </p>
            <div className="flex justify-center space-x-4">
              <Button onClick={() => navigate('/')}>
                Go to Home
              </Button>
              <Button variant="secondary" onClick={() => navigate('/dashboard')}>
                Go to Dashboard
              </Button>
            </div>
          </Card>
        </motion.div>
      </div>
    </div>
  )
}