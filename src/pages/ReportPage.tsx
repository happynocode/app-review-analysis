import React, { useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, Download, Share2, Calendar, BarChart3 } from 'lucide-react'
import { ThemeCard } from '../components/ThemeCard'
import { SidebarNav } from '../components/SidebarNav'
import { Button } from '../components/ui/Button'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { useReportStore } from '../stores/reportStore'

export const ReportPage: React.FC = () => {
  const { reportId } = useParams()
  const navigate = useNavigate()
  const { currentReport, loading, fetchReport } = useReportStore()
  const themeRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    if (reportId) {
      fetchReport(reportId)
    }
  }, [reportId, fetchReport])

  const scrollToTheme = (index: number) => {
    themeRefs.current[index]?.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    })
  }

  const handleDownload = () => {
    // Implement report download functionality
    console.log('Downloading report...')
  }

  const handleShare = () => {
    // Implement share functionality
    navigator.clipboard.writeText(window.location.href)
    // Show toast notification
  }

  if (loading) {
    return <LoadingSpinner message="Loading report..." />
  }

  if (!currentReport) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0A1128] via-[#0F1B3C] to-[#0A1128] flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-white mb-4">Report not found</h2>
          <Button onClick={() => navigate('/dashboard')}>
            Back to Dashboard
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0A1128] via-[#0F1B3C] to-[#0A1128]">
      {/* Header */}
      <header className="border-b border-white/10 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <Button
                variant="ghost"
                onClick={() => navigate('/dashboard')}
                className="p-2"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div>
                <h1 className="text-2xl font-bold text-white">
                  {currentReport.app_name} Analysis
                </h1>
                <div className="flex items-center text-white/60 text-sm mt-1">
                  <Calendar className="w-4 h-4 mr-1" />
                  <span>Generated {new Date(currentReport.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
            
            <div className="flex items-center space-x-3">
              <Button variant="secondary" onClick={handleShare} icon={Share2}>
                Share
              </Button>
              <Button variant="secondary" onClick={handleDownload} icon={Download}>
                Download
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid lg:grid-cols-4 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-3 space-y-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6"
            >
              <div className="flex items-center mb-4">
                <BarChart3 className="w-6 h-6 text-[#2DD4BF] mr-3" />
                <h2 className="text-xl font-semibold text-white">Analysis Overview</h2>
              </div>
              <p className="text-white/70 leading-relaxed">
                This report analyzes user reviews and feedback for <strong className="text-white">{currentReport.app_name}</strong> across 
                multiple platforms including App Store, Google Play, and Reddit. We've identified the top themes 
                that users discuss most frequently, along with representative quotes and actionable product suggestions.
              </p>
            </motion.div>

            {currentReport.themes?.map((theme, index) => (
              <div
                key={theme.id}
                ref={(el) => (themeRefs.current[index] = el)}
              >
                <ThemeCard theme={theme} index={index} />
              </div>
            )) || (
              <div className="text-center py-12">
                <h3 className="text-lg font-medium text-white mb-2">No themes available</h3>
                <p className="text-white/60">This report is still being processed or contains no data.</p>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="lg:col-span-1">
            {currentReport.themes && currentReport.themes.length > 0 && (
              <SidebarNav themes={currentReport.themes} onThemeClick={scrollToTheme} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}