import React, { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, Download, Share2, Calendar, BarChart3, RefreshCw } from 'lucide-react'
import { ThemeCard } from '../components/ThemeCard'
import { SidebarNav } from '../components/SidebarNav'

import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { useReportStore } from '../stores/reportStore'
import { supabase } from '../lib/supabase'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'

interface ProcessingProgress {
  report_id: string
  status: string
  total_batches: number
  completed_batches: number
  progress_percentage: number
  estimated_completion?: string
  current_stage: string
  error_message?: string
}

export const ReportPage: React.FC = () => {
  const { reportId } = useParams()
  const navigate = useNavigate()
  const { currentReport, loading, fetchReport, setCurrentReport, setLoading } = useReportStore()
  const themeRefs = useRef<(HTMLDivElement | null)[]>([])
  const [activeTab, setActiveTab] = useState<'report'>('report')
  const [activePlatform, setActivePlatform] = useState<'all' | 'reddit' | 'app_store' | 'google_play'>('all')
  const [processingProgress, setProcessingProgress] = useState<ProcessingProgress | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  useEffect(() => {
    if (reportId) {
      // Check if this is a public report access
      const urlParams = new URLSearchParams(location.search)
      const isPublicAccess = urlParams.get('public') === 'true'
      
      if (isPublicAccess) {
        // For public access, fetch report directly without user authentication
        fetchPublicReport(reportId)
      } else {
        // Regular authenticated access
        fetchReport(reportId)
      }
    }
  }, [reportId, fetchReport])

  // 定期刷新处理进度
  useEffect(() => {
    if (reportId && activeTab === 'report') {
      const interval = setInterval(() => {
        fetchProcessingProgress()
      }, 10000) // 每10秒更新一次

      return () => clearInterval(interval)
    }
  }, [reportId, activeTab])

  const fetchProcessingProgress = async () => {
    if (!reportId) return

    try {
      // 获取报告状态
      const { data: report, error } = await supabase
        .from('reports')
        .select('status')
        .eq('id', reportId)
        .single()

      if (error) throw error

      // 如果报告还在处理中，获取详细进度
      if (report.status === 'processing') {
        const { data: tasks, error: tasksError } = await supabase
          .from('analysis_tasks')
          .select('*')
          .eq('report_id', reportId)

        if (tasksError) throw tasksError

        const totalBatches = tasks.length
        const completedBatches = tasks.filter(task => task.status === 'completed').length
        const processingBatches = tasks.filter(task => task.status === 'processing').length
        const progressPercentage = totalBatches > 0 ? (completedBatches / totalBatches) * 100 : 0

        // 估算完成时间
        const avgProcessingTime = 30 // 假设每批次30秒
        const remainingBatches = totalBatches - completedBatches - processingBatches
        const estimatedSeconds = remainingBatches * avgProcessingTime
        const estimatedCompletion = new Date(Date.now() + estimatedSeconds * 1000).toLocaleTimeString()

        setProcessingProgress({
          report_id: reportId,
          status: report.status,
          total_batches: totalBatches,
          completed_batches: completedBatches,
          progress_percentage: progressPercentage,
          estimated_completion: estimatedCompletion,
          current_stage: processingBatches > 0 ? `Processing batch ${completedBatches + 1}/${totalBatches}` : 'Waiting for processing',
        })
      } else {
        setProcessingProgress(null)
      }
    } catch (error) {
      console.error('Error fetching processing progress:', error)
    }
  }

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await Promise.all([
      fetchReport(reportId!),
      fetchProcessingProgress()
    ])
    setIsRefreshing(false)
  }

  const scrollToTheme = (index: number) => {
    themeRefs.current[index]?.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    })
  }

  const handleDownload = async () => {
    if (!currentReport) return
    
    try {
      // Create a new jsPDF instance
      const pdf = new jsPDF('p', 'mm', 'a4')
      const pageWidth = pdf.internal.pageSize.getWidth()
      const pageHeight = pdf.internal.pageSize.getHeight()
      const margin = 20
      let yPosition = margin
      
      // Title
      pdf.setFontSize(24)
      pdf.setFont('helvetica', 'bold')
      pdf.text(`${currentReport.user_search_term || currentReport.app_name} Analysis Report`, margin, yPosition)
      yPosition += 15
      
      // Date
      pdf.setFontSize(12)
      pdf.setFont('helvetica', 'normal')
      pdf.text(`Generated: ${new Date(currentReport.created_at).toLocaleDateString()}`, margin, yPosition)
      yPosition += 20
      
      // Overview
      pdf.setFontSize(16)
      pdf.setFont('helvetica', 'bold')
      pdf.text('Analysis Overview', margin, yPosition)
      yPosition += 10
      
      pdf.setFontSize(11)
      pdf.setFont('helvetica', 'normal')
      const overviewText = `This report analyzes user reviews and feedback for ${currentReport.user_search_term || currentReport.app_name} across multiple platforms including App Store, Google Play, and Reddit. We've identified the top themes that users discuss most frequently, along with representative quotes and actionable product suggestions.`
      const splitOverview = pdf.splitTextToSize(overviewText, pageWidth - 2 * margin)
      pdf.text(splitOverview, margin, yPosition)
      yPosition += splitOverview.length * 5 + 15
      
      // Platform Statistics
      const platformStats = getPlatformStats()
      pdf.setFontSize(16)
      pdf.setFont('helvetica', 'bold')
      pdf.text('Platform Statistics', margin, yPosition)
      yPosition += 10
      
      pdf.setFontSize(11)
      pdf.setFont('helvetica', 'normal')
      pdf.text(`Total Themes: ${platformStats.total}`, margin, yPosition)
      yPosition += 7
      pdf.text(`Reddit: ${platformStats.reddit} themes`, margin, yPosition)
      yPosition += 7
      pdf.text(`App Store: ${platformStats.app_store} themes`, margin, yPosition)
      yPosition += 7
      pdf.text(`Google Play: ${platformStats.google_play} themes`, margin, yPosition)
      yPosition += 20
      
      // Themes
      const themes = getCurrentThemes()
      if (themes && themes.length > 0) {
        pdf.setFontSize(16)
        pdf.setFont('helvetica', 'bold')
        pdf.text('Key Themes', margin, yPosition)
        yPosition += 15
        
        themes.forEach((theme, index) => {
          // Check if we need a new page
          if (yPosition > pageHeight - 50) {
            pdf.addPage()
            yPosition = margin
          }
          
          // Theme title
          pdf.setFontSize(14)
          pdf.setFont('helvetica', 'bold')
          pdf.text(`${index + 1}. ${theme.title}`, margin, yPosition)
          yPosition += 10
          
          // Platform badge
          pdf.setFontSize(10)
          pdf.setFont('helvetica', 'normal')
          const platformName = getPlatformName(theme.platform)
          pdf.text(`Platform: ${platformName}`, margin + 5, yPosition)
          yPosition += 8
          
          // Description
          pdf.setFontSize(11)
          pdf.setFont('helvetica', 'normal')
          const splitDescription = pdf.splitTextToSize(theme.description, pageWidth - 2 * margin - 5)
          pdf.text(splitDescription, margin + 5, yPosition)
          yPosition += splitDescription.length * 5 + 5
          
          // Representative quote
          if (theme.quotes && theme.quotes.length > 0) {
            pdf.setFontSize(10)
            pdf.setFont('helvetica', 'italic')
            pdf.text('Representative Quote:', margin + 5, yPosition)
            yPosition += 6
            
            const splitQuote = pdf.splitTextToSize(`"${theme.quotes[0].text}"`, pageWidth - 2 * margin - 10)
            pdf.text(splitQuote, margin + 10, yPosition)
            yPosition += splitQuote.length * 4 + 5
          }
          
          // Product suggestions
          if (theme.suggestions && theme.suggestions.length > 0) {
            pdf.setFontSize(10)
            pdf.setFont('helvetica', 'bold')
            pdf.text('Product Suggestions:', margin + 5, yPosition)
            yPosition += 6
            
            pdf.setFont('helvetica', 'normal')
            theme.suggestions.forEach((suggestion, idx) => {
              if (idx < 3) { // Limit to first 3 suggestions
                const splitSuggestion = pdf.splitTextToSize(`• ${suggestion.text}`, pageWidth - 2 * margin - 10)
                pdf.text(splitSuggestion, margin + 10, yPosition)
                yPosition += splitSuggestion.length * 4 + 3
              }
            })
            yPosition += 5
          }
          
          yPosition += 5
        })
      }
      
      // Footer
      const totalPages = pdf.getNumberOfPages()
      for (let i = 1; i <= totalPages; i++) {
        pdf.setPage(i)
        pdf.setFontSize(8)
        pdf.setFont('helvetica', 'normal')
        pdf.text(`Page ${i} of ${totalPages}`, pageWidth - margin - 20, pageHeight - 10)
        pdf.text('Generated by App Review Analysis', margin, pageHeight - 10)
      }
      
      // Save the PDF
      const fileName = `${currentReport.user_search_term || currentReport.app_name}_Analysis_Report.pdf`
      pdf.save(fileName)
      
    } catch (error) {
      console.error('Error generating PDF:', error)
      alert('Failed to generate PDF. Please try again.')
    }
  }

  const handleShare = async () => {
    if (!currentReport) return
    
    try {
      // Make the report public by updating its public flag
      const { error } = await supabase
        .from('reports')
        .update({ is_public: true })
        .eq('id', reportId)
      
      if (error) throw error
      
      // Create shareable URL
      const shareableUrl = `${window.location.origin}/report/${reportId}?public=true`
      
      // Copy to clipboard
      await navigator.clipboard.writeText(shareableUrl)
      
      // Show success message
      alert('Shareable link copied to clipboard! Anyone with this link can view the report.')
    } catch (error) {
      console.error('Error sharing report:', error)
      alert('Failed to create shareable link. Please try again.')
    }
  }

  // 获取当前显示的themes
  const getCurrentThemes = () => {
    if (!currentReport?.platformThemes) {
      return currentReport?.themes || []
    }

    switch (activePlatform) {
      case 'reddit':
        return currentReport.platformThemes.reddit
      case 'app_store':
        return currentReport.platformThemes.app_store
      case 'google_play':
        return currentReport.platformThemes.google_play
      case 'all':
      default:
        return currentReport?.themes || []
    }
  }

  // 获取平台统计信息
  const getPlatformStats = () => {
    if (!currentReport?.platformThemes) {
      return {
        reddit: 0,
        app_store: 0,
        google_play: 0,
        total: currentReport?.themes?.length || 0
      }
    }

    const stats = {
      reddit: currentReport.platformThemes.reddit.length,
      app_store: currentReport.platformThemes.app_store.length,
      google_play: currentReport.platformThemes.google_play.length,
      total: 0
    }
    
    stats.total = stats.reddit + stats.app_store + stats.google_play
    return stats
  }

  const currentThemes = getCurrentThemes()
  const platformStats = getPlatformStats()

  // 获取平台名称显示
  const getPlatformName = (platform: string) => {
    switch (platform) {
      case 'reddit': return 'Reddit'
      case 'app_store': return 'App Store'
      case 'google_play': return 'Google Play'
      case 'all': return 'All Platforms'
      default: return platform
    }
  }

  // 获取平台颜色
  const getPlatformColor = (platform: string) => {
    switch (platform) {
      case 'reddit': return 'text-orange-400'
      case 'app_store': return 'text-blue-400'
      case 'google_play': return 'text-green-400'
      case 'all': return 'text-[#2DD4BF]'
      default: return 'text-white'
    }
  }

  const fetchPublicReport = async (reportId: string) => {
    setLoading(true)
    try {
      // Check if report is public
      const { data: report, error: reportError } = await supabase
        .from('reports')
        .select('*')
        .eq('id', reportId)
        .eq('is_public', true)
        .single()

      if (reportError) throw new Error('Report not found or not public')

      // Fetch themes for public report
      const { data: themes, error: themesError } = await supabase
        .from('themes')
        .select(`
          id,
          title,
          description,
          platform,
          quotes (
            id,
            text,
            source,
            review_date
          ),
          suggestions (
            id,
            text
          )
        `)
        .eq('report_id', reportId)
        .order('created_at', { ascending: true })

      if (themesError) throw themesError

      // Group themes by platform
      const platformThemes: { reddit: any[], app_store: any[], google_play: any[] } = {
        reddit: [],
        app_store: [],
        google_play: []
      }

      if (themes) {
        for (const theme of themes) {
          const themeWithDetails = {
            ...theme,
            quotes: theme.quotes || [],
            suggestions: theme.suggestions || []
          }

          if (theme.platform === 'reddit') {
            platformThemes.reddit.push(themeWithDetails)
          } else if (theme.platform === 'app_store') {
            platformThemes.app_store.push(themeWithDetails)
          } else if (theme.platform === 'google_play') {
            platformThemes.google_play.push(themeWithDetails)
          }
        }
      }

      const allThemes = [...platformThemes.reddit, ...platformThemes.app_store, ...platformThemes.google_play]

      setCurrentReport({
        ...report,
        themes: allThemes,
        platformThemes
      })
      setLoading(false)
    } catch (error) {
      console.error('Error fetching public report:', error)
      setLoading(false)
      // Redirect to 404 or show error message
      navigate('/')
    }
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
                  {currentReport.user_search_term || currentReport.app_name} Analysis
                </h1>
                <div className="flex items-center text-white/60 text-sm mt-1">
                  <Calendar className="w-4 h-4 mr-1" />
                  <span>Generated {new Date(currentReport.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
            
            <div className="flex items-center space-x-3">

              <Button
                variant="secondary"
                onClick={handleRefresh}
                icon={RefreshCw}
                disabled={isRefreshing}
              >
                {isRefreshing ? 'Refreshing...' : 'Refresh'}
              </Button>
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


        {/* Processing Progress Bar */}
        {processingProgress && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6"
          >
            <Card className="p-6 bg-blue-50 border-blue-200">
              <div className="flex items-center justify-between mb-3">
                                 <div className="flex items-center">
                   <LoadingSpinner size="sm" inline={true} message="" />
                   <span className="ml-2 font-medium text-blue-900">
                     {processingProgress.current_stage}
                   </span>
                 </div>
                <span className="text-blue-700 font-medium">
                  {processingProgress.progress_percentage.toFixed(1)}%
                </span>
              </div>
              
              <div className="w-full bg-blue-200 rounded-full h-3 mb-3">
                <div
                  className="bg-blue-600 h-3 rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${processingProgress.progress_percentage}%` }}
                />
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-blue-700">
                <div>
                  <span className="font-medium">Total Batches:</span> {processingProgress.total_batches}
                </div>
                <div>
                  <span className="font-medium">Completed:</span> {processingProgress.completed_batches}
                </div>
                <div>
                  <span className="font-medium">Remaining:</span> {processingProgress.total_batches - processingProgress.completed_batches}
                </div>
                {processingProgress.estimated_completion && (
                  <div>
                    <span className="font-medium">Estimated Completion:</span> {processingProgress.estimated_completion}
                  </div>
                )}
              </div>
            </Card>
          </motion.div>
        )}

{/* Report Content */}
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
                This report analyzes user reviews and feedback for <strong className="text-white">{currentReport.user_search_term || currentReport.app_name}</strong> across 
                multiple platforms including App Store, Google Play, and Reddit. We've identified the top themes 
                that users discuss most frequently, along with representative quotes and actionable product suggestions.
              </p>
            </motion.div>

            {/* Platform Selection */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">Platform Analysis</h3>
                <div className="text-sm text-white/60">
                  Total: {platformStats.total} themes
                </div>
              </div>
              
              {/* Platform Tabs */}
              <div className="flex flex-wrap gap-2 mb-4">
                {[
                  { key: 'all', label: 'All Platforms', count: platformStats.total },
                  { key: 'reddit', label: 'Reddit', count: platformStats.reddit },
                  { key: 'app_store', label: 'App Store', count: platformStats.app_store },
                  { key: 'google_play', label: 'Google Play', count: platformStats.google_play }
                ].map(({ key, label, count }) => (
                  <button
                    key={key}
                    onClick={() => setActivePlatform(key as any)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                      activePlatform === key
                        ? 'bg-[#2DD4BF] text-black'
                        : 'bg-white/10 text-white/70 hover:bg-white/20 hover:text-white'
                    }`}
                  >
                    {label} ({count})
                  </button>
                ))}
              </div>

              {/* Platform Statistics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center p-3 bg-white/5 rounded-lg">
                  <div className="text-2xl font-bold text-orange-400">{platformStats.reddit}</div>
                  <div className="text-xs text-white/60">Reddit Themes</div>
                </div>
                <div className="text-center p-3 bg-white/5 rounded-lg">
                  <div className="text-2xl font-bold text-blue-400">{platformStats.app_store}</div>
                  <div className="text-xs text-white/60">App Store Themes</div>
                </div>
                <div className="text-center p-3 bg-white/5 rounded-lg">
                  <div className="text-2xl font-bold text-green-400">{platformStats.google_play}</div>
                  <div className="text-xs text-white/60">Google Play Themes</div>
                </div>
                <div className="text-center p-3 bg-white/5 rounded-lg">
                  <div className="text-2xl font-bold text-[#2DD4BF]">{platformStats.total}</div>
                  <div className="text-xs text-white/60">Total Themes</div>
                </div>
              </div>

              {/* Current Platform Display */}
              {activePlatform !== 'all' && (
                <div className="mt-4 p-3 bg-white/5 rounded-lg">
                  <div className="flex items-center">
                    <div className={`w-3 h-3 rounded-full mr-2 ${getPlatformColor(activePlatform).replace('text-', 'bg-')}`}></div>
                    <span className="text-white font-medium">
                      Showing {getPlatformName(activePlatform)} themes ({currentThemes.length})
                    </span>
                  </div>
                </div>
              )}
            </motion.div>

            {currentThemes.map((theme, index) => (
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
              {currentThemes && currentThemes.length > 0 && (
                <SidebarNav themes={currentThemes} onThemeClick={scrollToTheme} />
              )}
            </div>
          </div>
      </div>
    </div>
  )
}