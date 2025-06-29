import React, { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { Plus, Clock, CheckCircle, XCircle, BarChart3, Calendar, ArrowRight, RefreshCw, Trash2, AlertTriangle, Activity, X } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { DeleteAllDataModal } from '../components/DeleteAllDataModal'
import { useAuthStore } from '../stores/authStore'
import { useReportStore } from '../stores/reportStore'

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate()
  const { user, signOut } = useAuthStore()
  const { reports, loading, fetchUserReports, setReports } = useReportStore()
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [retryingReports, setRetryingReports] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (user) {
      fetchUserReports(user.id)
    }
    
    // Clean up any existing interval on unmount
    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current)
      }
    }
  }, [user, fetchUserReports])

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-400" />
      case 'processing':
        return <Clock className="w-4 h-4 text-yellow-400 animate-spin" />
      case 'scraping':
        return <Activity className="w-4 h-4 text-blue-400 animate-pulse" />
      case 'scraping_completed':
        return <Activity className="w-4 h-4 text-blue-600" />
      case 'analyzing':
        return <BarChart3 className="w-4 h-4 text-purple-400 animate-pulse" />
      case 'completing':
        return <CheckCircle className="w-4 h-4 text-green-500 animate-pulse" />
      case 'failed':
        return <X className="w-4 h-4 text-red-400" />
      case 'error':
        return <X className="w-4 h-4 text-red-400" />
      default:
        return <Clock className="w-4 h-4 text-white/40" />
    }
  }

  const getStatusText = (status: string, report?: any) => {
    switch (status) {
      case 'completed':
        return 'Completed'
      case 'processing':
        return 'Processing'
      case 'scraping':
        return 'Scraping Data'
      case 'scraping_completed':
        return 'Scraping Complete'
      case 'analyzing':
        return 'Analyzing Reviews'
      case 'completing':
        return 'Finalizing Report'
      case 'failed':
        if (report?.failure_stage === 'scraping') {
          return 'Scraping Failed (No Data)'
        } else if (report?.failure_stage === 'analysis') {
          return 'Analysis Failed'
        }
        return 'Failed'
      case 'error':
        return 'Error'
      default:
        return 'Pending'
    }
  }

  const handleViewReport = (reportId: string) => {
    navigate(`/report/${reportId}`)
  }

  const handleNewReport = () => {
    navigate('/')
  }

  const handleRefresh = async () => {
    if (user) {
      await fetchUserReports(user.id)
    }
  }

  const handleRetryReport = async (reportId: string, appName: string) => {
    // Prevent duplicate retry attempts
    if (retryingReports.has(reportId)) {
      console.log(`Report ${reportId} is already being retried`)
      return
    }

    // Add to retrying set
    setRetryingReports(prev => new Set(prev).add(reportId))

    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({
          reportId,
          appName
        })
      })

      if (response.ok) {
        // Refresh reports to show updated status
        await handleRefresh()
      } else {
        throw new Error('Failed to retry report generation')
      }
    } catch (error) {
      console.error('Error retrying report:', error)
      alert('Error retrying report generation, please try again later')
    } finally {
      // Remove from retrying set
      setRetryingReports(prev => {
        const newSet = new Set(prev)
        newSet.delete(reportId)
        return newSet
      })
    }
  }

  const handleDeleteAllData = async () => {
    if (!user) return

    setDeleteLoading(true)
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-all-data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({
          userId: user.id,
          confirmationText: 'DELETE ALL MY DATA'
        })
      })

      if (response.ok) {
        const result = await response.json()
        console.log('Data deletion result:', result)
        
        // Clear local state
        setReports([])
        setShowDeleteModal(false)
        
        // Show success message
        alert(`Successfully deleted all data:\n• ${result.deletedCounts.reports} reports\n• ${result.deletedCounts.scraped_reviews} scraped reviews\n• ${result.deletedCounts.themes} themes\n• ${result.deletedCounts.quotes} quotes\n• ${result.deletedCounts.suggestions} suggestions\n• ${result.deletedCounts.scraping_sessions} scraping sessions\n\nTotal: ${result.totalDeleted} items deleted`)
      } else {
        const error = await response.json()
        throw new Error(error.error || 'Failed to delete data')
      }
    } catch (error) {
      console.error('Error deleting data:', error)
      alert(`Error deleting data: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setDeleteLoading(false)
    }
  }

  // Check if there are any processing reports to show a helpful message
  const hasProcessingReports = reports.some(r =>
    r.status === 'processing' || r.status === 'scraping' || r.status === 'scraping_completed' || r.status === 'analyzing' || r.status === 'completing'
  )

  if (loading) {
    return <LoadingSpinner message="Loading dashboard..." />
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0A1128] via-[#0F1B3C] to-[#0A1128]">
      {/* Header */}
      <header className="border-b border-white/10 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center space-x-2"
          >
            <BarChart3 className="w-6 h-6 sm:w-8 sm:h-8 text-[#2DD4BF]" />
            <span className="text-lg sm:text-xl font-bold text-white">FeedbackLens</span>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center space-x-2 sm:space-x-4"
          >
            <span className="text-white/70 text-sm hidden sm:inline">Welcome, {user?.email}</span>
            <Button variant="ghost" size="sm" onClick={async () => {
              try {
                await signOut()
                navigate('/')
              } catch (error) {
                console.error('Sign out error:', error)
                // Even if signOut fails, navigate to home
                navigate('/')
              }
            }}>
              Sign Out
            </Button>
          </motion.div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Page Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 sm:mb-8 gap-4"
        >
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">Dashboard</h1>
            <p className="text-white/70 text-sm sm:text-base">Manage your analysis reports</p>
            {hasProcessingReports && (
              <p className="text-yellow-400 text-sm mt-1 flex items-center">
                <Clock className="w-4 h-4 mr-1" />
                Some reports are still processing. Click refresh to check for updates.
              </p>
            )}
          </div>
          <div className="flex items-center space-x-2 sm:space-x-3">
            <Button
              variant="secondary"
              onClick={handleRefresh}
              icon={RefreshCw}
              disabled={loading}
              size="sm"
              className="text-sm"
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </Button>
            <Button onClick={handleNewReport} icon={Plus} size="sm" className="text-sm">
              New Report
            </Button>
          </div>
        </motion.div>

        {/* Stats Cards */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6 mb-6 sm:mb-8"
        >
          <Card className="p-4 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/60 text-xs sm:text-sm">Total Reports</p>
                <p className="text-lg sm:text-2xl font-bold text-white">{reports.length}</p>
              </div>
              <BarChart3 className="w-6 h-6 sm:w-8 sm:h-8 text-[#2DD4BF]" />
            </div>
          </Card>
          <Card className="p-4 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/60 text-xs sm:text-sm">Completed</p>
                <p className="text-lg sm:text-2xl font-bold text-white">
                  {reports.filter(r => r.status === 'completed').length}
                </p>
              </div>
              <CheckCircle className="w-6 h-6 sm:w-8 sm:h-8 text-green-400" />
            </div>
          </Card>
          <Card className="p-4 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/60 text-xs sm:text-sm">Processing</p>
                <p className="text-lg sm:text-2xl font-bold text-white">
                  {reports.filter(r =>
                    r.status === 'processing' || r.status === 'scraping' || r.status === 'scraping_completed' || r.status === 'analyzing' || r.status === 'completing'
                  ).length}
                </p>
              </div>
              <Clock className="w-6 h-6 sm:w-8 sm:h-8 text-yellow-400" />
            </div>
          </Card>
          <Card className="p-4 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/60 text-xs sm:text-sm">This Month</p>
                <p className="text-lg sm:text-2xl font-bold text-white">
                  {reports.filter(r =>
                    new Date(r.created_at).getMonth() === new Date().getMonth()
                  ).length}
                </p>
              </div>
              <Calendar className="w-6 h-6 sm:w-8 sm:h-8 text-[#2DD4BF]" />
            </div>
          </Card>
        </motion.div>

        {/* Reports Table */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Card>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-white">Recent Reports</h2>
              <div className="flex items-center space-x-3">
                {hasProcessingReports && (
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={handleRefresh}
                    icon={RefreshCw}
                    className="text-yellow-400 hover:text-yellow-300"
                  >
                    Check Updates
                  </Button>
                )}
                {reports.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowDeleteModal(true)}
                    icon={Trash2}
                    className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                  >
                    Delete All Data
                  </Button>
                )}
              </div>
            </div>
            
            <div className="space-y-4">
              {reports.map((report, index) => (
                <motion.div
                  key={report.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + index * 0.1 }}
                  className="flex items-center justify-between p-3 sm:p-4 bg-white/5 rounded-xl border border-white/10 hover:bg-white/10 transition-all duration-200 min-w-0"
                >
                  <div className="flex items-center space-x-3 sm:space-x-4 flex-1 min-w-0">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-[#2DD4BF]/20 rounded-lg flex items-center justify-center flex-shrink-0">
                      <BarChart3 className="w-5 h-5 sm:w-6 sm:h-6 text-[#2DD4BF]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-white text-sm sm:text-base truncate">
                        {report.user_search_term || report.app_name}
                      </h3>

                      {report.selected_app_name && report.selected_app_name !== report.user_search_term && (
                        <div className="text-xs sm:text-sm text-white/70 mt-1">
                          <span className="bg-green-500/20 text-green-300 px-2 py-1 rounded-md truncate inline-block max-w-full">
                            App: {report.selected_app_name}
                          </span>
                        </div>
                      )}

                      <div className="flex flex-col sm:flex-row sm:items-center sm:space-x-4 text-xs sm:text-sm text-white/60 mt-2 gap-1 sm:gap-0">
                        <div className="flex items-center">
                          <Calendar className="w-3 h-3 sm:w-4 sm:h-4 mr-1 flex-shrink-0" />
                          <span className="truncate">{new Date(report.created_at).toLocaleDateString()}</span>
                        </div>
                        <div className="flex items-center">
                          {getStatusIcon(report.status)}
                          <span className="ml-1 truncate">{getStatusText(report.status, report)}</span>
                        </div>

                        {report.enabled_platforms && report.enabled_platforms.length > 0 && (
                          <div className="flex items-center min-w-0">
                            <span className="text-white/40 mr-2 hidden sm:inline">Platforms:</span>
                            <div className="flex space-x-1 flex-wrap">
                              {report.enabled_platforms.map((platform: string) => (
                                <span
                                  key={platform}
                                  className={`px-1.5 sm:px-2 py-0.5 sm:py-1 rounded text-xs font-medium ${
                                    platform === 'app_store' ? 'bg-gray-500/20 text-gray-300' :
                                    platform === 'google_play' ? 'bg-green-500/20 text-green-300' :
                                    platform === 'reddit' ? 'bg-orange-500/20 text-orange-300' :
                                    'bg-white/10 text-white/60'
                                  }`}
                                >
                                  {platform === 'app_store' ? 'iOS' :
                                   platform === 'google_play' ? 'Android' :
                                   platform === 'reddit' ? 'Reddit' : platform}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        
                        <div className="flex items-center">
                          <Clock className="w-4 h-4 mr-1 text-blue-400" />
                          <span className="text-blue-300 text-xs bg-blue-500/20 px-2 py-1 rounded">
                            Past {report.time_filter_days || 90} days
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-2 sm:space-x-3 flex-shrink-0">
                    {report.status === 'completed' && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleViewReport(report.id)}
                        icon={ArrowRight}
                        className="text-xs sm:text-sm"
                      >
                        <span className="hidden sm:inline">View Report</span>
                        <span className="sm:hidden">View</span>
                      </Button>
                    )}
                    {(report.status === 'processing' || report.status === 'scraping' || report.status === 'scraping_completed' || report.status === 'analyzing' || report.status === 'completing') && (
                      <div className="text-yellow-400 text-xs sm:text-sm flex items-center">
                        <Clock className="w-3 h-3 sm:w-4 sm:h-4 mr-1 animate-spin" />
                        <span className="hidden sm:inline">
                          {report.status === 'scraping' ? 'Scraping...' :
                           report.status === 'scraping_completed' ? 'Starting analysis...' :
                           report.status === 'analyzing' ? 'Analyzing...' :
                           report.status === 'completing' ? 'Finalizing...' : 'Processing...'}
                        </span>
                        <span className="sm:hidden">Processing</span>
                      </div>
                    )}
                    {(report.status === 'error' || report.status === 'failed') && (
                      <div className="flex items-center space-x-1 sm:space-x-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleRetryReport(report.id, report.app_name)}
                          disabled={retryingReports.has(report.id)}
                          loading={retryingReports.has(report.id)}
                          className="text-xs sm:text-sm"
                        >
                          {retryingReports.has(report.id) ? 'Retrying...' : 'Retry'}
                        </Button>
                        {report.failure_details && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              const message = report.failure_stage === 'scraping'
                                ? `Scraping failed: ${report.error_message}\n\nSuggestion: ${report.failure_details?.suggestion || 'Please try using different keywords'}`
                                : `Analysis failed: ${report.error_message}\n\nReason: ${report.failure_details?.reason || 'System error'}`
                              alert(message)
                            }}
                            className="text-gray-400 hover:text-gray-300 text-xs sm:text-sm hidden sm:inline-flex"
                          >
                            Details
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
            
            {reports.length === 0 && (
              <div className="text-center py-12">
                <BarChart3 className="w-16 h-16 text-white/20 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-white mb-2">No reports yet</h3>
                <p className="text-white/60 mb-6">Create your first analysis report to get started</p>
                <Button onClick={handleNewReport} icon={Plus}>
                  Create Report
                </Button>
              </div>
            )}
          </Card>
        </motion.div>

        {/* Danger Zone */}
        {reports.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="mt-8"
          >
            <Card className="border-red-500/20 bg-red-500/5">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-red-500/20 rounded-full flex items-center justify-center">
                    <AlertTriangle className="w-5 h-5 text-red-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white">Danger Zone</h3>
                    <p className="text-white/70 text-sm">
                      Permanently delete all your reports, scraped data, and analysis results
                    </p>
                  </div>
                </div>
                <Button
                  onClick={() => setShowDeleteModal(true)}
                  className="bg-red-600 hover:bg-red-700 text-white"
                  icon={Trash2}
                >
                  Delete All Data
                </Button>
              </div>
            </Card>
          </motion.div>
        )}
      </div>

      {/* Delete All Data Modal */}
      <DeleteAllDataModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleDeleteAllData}
        loading={deleteLoading}
      />
    </div>
  )
}