import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { BarChart3, Users, Zap, Shield, Star, TrendingUp } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { AuthModal } from '../components/AuthModal'
import { AppSelectionModal } from '../components/AppSelectionModal'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { useAuthStore } from '../stores/authStore'
import { useReportStore } from '../stores/reportStore'
import { useNavigate } from 'react-router-dom'

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

export const LandingPage: React.FC = () => {
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [showAppSelection, setShowAppSelection] = useState(false)
  const [companyName, setCompanyName] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const { user } = useAuthStore()
  const { createNewReport } = useReportStore()
  const navigate = useNavigate()

  const handleGenerateReport = async () => {
    if (!user) {
      setShowAuthModal(true)
      return
    }

    if (!companyName.trim()) {
      // Show company name input if not provided
      const name = prompt('Please enter company or app name (e.g., Uber, Instagram, Spotify):')
      if (!name?.trim()) return
      setCompanyName(name.trim())
    }

    // Prevent duplicate submissions
    if (isGenerating) {
      return
    }

    // Show app selection modal first
    setShowAppSelection(true)
  }

  const handleAppsSelected = async (selectedApps: AppInfo[], enabledPlatforms: string[], timeFilterDays: number) => {
    if (enabledPlatforms.length === 0) {
      alert('Please select at least one platform for analysis')
      return
    }

    setIsGenerating(true)
    
    try {
      // Create a report based on selected apps and platforms
      let reportName: string
      let selectedAppName: string
      
      if (selectedApps.length === 1) {
        // Single app analysis
        reportName = selectedApps[0].name
        selectedAppName = selectedApps[0].name
      } else if (selectedApps.length > 1) {
        // Multiple apps analysis
        const appNames = selectedApps.map(app => app.name).join(', ')
        reportName = `${companyName} (${selectedApps.length} apps)`
        selectedAppName = appNames
      } else {
        // Platform-only analysis (no specific apps)
        reportName = `${companyName} (${enabledPlatforms.map(p => 
          p === 'app_store' ? 'iOS' : 
          p === 'google_play' ? 'Android' : 
          p === 'reddit' ? 'Reddit' : p
        ).join(', ')})`
        selectedAppName = companyName
      }
      
      const report = await createNewReport(
        user!.id, 
        reportName, 
        companyName, // userSearchTerm
        selectedAppName, // selectedAppName  
        enabledPlatforms, // enabledPlatforms
        timeFilterDays // timeFilterDays
      )

      // Start report generation
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-report`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          reportId: report.id,
          appName: reportName,
          userSearchTerm: companyName,
          selectedAppName: selectedAppName,
          appInfo: selectedApps.length === 1 ? selectedApps[0] : undefined,
          selectedApps: selectedApps.length > 1 ? selectedApps : undefined,
          enabledPlatforms: enabledPlatforms,
          redditOnly: enabledPlatforms.length === 1 && enabledPlatforms[0] === 'reddit'
        })
      })

      if (response.ok) {
        navigate('/dashboard')
      } else {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to start report generation')
      }
    } catch (error) {
      console.error('Error generating report:', error)
      alert('Error generating report, please try again later')
    } finally {
      setIsGenerating(false)
      setCompanyName('')
    }
  }



  const features = [
    {
      icon: BarChart3,
      title: 'Deep Analysis',
      description: 'Extract key themes from thousands of user reviews across multiple platforms.'
    },
    {
      icon: Zap,
      title: 'Lightning Fast',
      description: 'Generate comprehensive reports in under 60 seconds with our AI-powered analysis.'
    },
    {
      icon: Users,
      title: 'Multi-Platform',
      description: 'Analyze reviews from App Store, Google Play, Reddit, and other major platforms.'
    }
  ]

  if (isGenerating) {
    return <LoadingSpinner message={`Generating analysis...`} />
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
            <span className="text-xl font-bold text-white">FeedbackLens</span>
          </motion.div>
          
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center space-x-4"
          >
            {user ? (
              <div className="flex items-center space-x-4">
                <span className="text-white/70">Welcome back!</span>
                <Button
                  variant="secondary"
                  onClick={() => navigate('/dashboard')}
                >
                  Dashboard
                </Button>
              </div>
            ) : (
              <Button
                variant="secondary"
                onClick={() => setShowAuthModal(true)}
              >
                Sign In
              </Button>
            )}
          </motion.div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-5xl md:text-6xl font-bold text-white mb-6 leading-tight"
          >
            Transform User Feedback
            <span className="text-[#2DD4BF] block">into Actionable Insights</span>
          </motion.h1>
          
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="text-xl text-white/70 mb-12 max-w-2xl mx-auto leading-relaxed"
          >
            Generate comprehensive reports from user reviews across App Store, Google Play, Reddit, and more.
            Get actionable insights in under 60 seconds.
          </motion.p>

          {/* Company Name Input for Logged In Users */}
          {user && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="mb-8 max-w-md mx-auto"
            >
              <input
                type="text"
                placeholder="Enter company or app name (e.g., Uber, Instagram)"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full px-6 py-4 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-[#2DD4BF] focus:border-transparent backdrop-blur-sm transition-all duration-200 text-lg"
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && companyName.trim() && !isGenerating) {
                    handleGenerateReport()
                  }
                }}
                disabled={isGenerating}
              />
            </motion.div>
          )}

          {/* Generate Report Button */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="mb-8"
          >
            <Button
              size="lg"
              onClick={handleGenerateReport}
              disabled={(user && !companyName.trim()) || isGenerating}
              loading={isGenerating}
              className="text-xl px-12 py-6 shadow-2xl shadow-[#2DD4BF]/30"
            >
              {isGenerating ? 'Generating...' : 'Generate Analysis'}
            </Button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6, duration: 0.6 }}
            className="text-center"
          >
            <p className="text-white/60 text-sm">
              {user 
                ? 'Enter a company name to analyze app reviews and Reddit discussions' 
                : 'Sign in to start generating reports'
              }
            </p>
          </motion.div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.6 }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl font-bold text-white mb-4">
              Why Choose FeedbackLens?
            </h2>
            <p className="text-xl text-white/70 max-w-2xl mx-auto">
              Powerful features designed for product managers, researchers, and analysts
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8">
            {features.map((feature, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.8 + index * 0.1 }}
              >
                <Card hover className="text-center h-full">
                  <feature.icon className="w-12 h-12 text-[#2DD4BF] mx-auto mb-4" />
                  <h3 className="text-xl font-semibold text-white mb-3">
                    {feature.title}
                  </h3>
                  <p className="text-white/70 leading-relaxed">
                    {feature.description}
                  </p>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 1.2 }}
          >
            <Card className="bg-gradient-to-r from-[#2DD4BF]/10 to-[#14B8A6]/10 border-[#2DD4BF]/20">
              <h2 className="text-3xl font-bold text-white mb-4">
                Ready to Get Started?
              </h2>
              <p className="text-white/70 mb-8 text-lg">
                Join thousands of product teams using FeedbackLens to make data-driven decisions
              </p>
              <Button
                size="lg"
                onClick={() => user ? handleGenerateReport() : setShowAuthModal(true)}
                className="text-lg px-8 py-4"
                disabled={isGenerating}
                loading={isGenerating}
              >
                {isGenerating ? 'Generating...' : (user ? 'Generate Analysis Now' : 'Start Free Trial')}
              </Button>
            </Card>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 py-8 px-6">
        <div className="max-w-6xl mx-auto text-center text-white/60">
          <p>&copy; 2025 FeedbackLens. All rights reserved.</p>
        </div>
      </footer>

      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
      
              <AppSelectionModal
          isOpen={showAppSelection}
          onClose={() => setShowAppSelection(false)}
          companyName={companyName}
          onAppsSelected={handleAppsSelected}
          onRedditOnlySelected={() => {}} // Deprecated, keeping for compatibility
        />
    </div>
  )
}