import React, { useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from './stores/authStore'
import { LandingPage } from './pages/LandingPage'
import { ReportPage } from './pages/ReportPage'
import { DashboardPage } from './pages/DashboardPage'
import { DemoPage } from './pages/DemoPage'
import { LoadingSpinner } from './components/LoadingSpinner'

const queryClient = new QueryClient()

function App() {
  const { initialize, loading } = useAuthStore()

  useEffect(() => {
    initialize()
  }, [initialize])

  if (loading) {
    return <LoadingSpinner message="Initializing..." />
  }

  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/report/:reportId" element={<ReportPage />} />
          <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="/demo" element={<DemoPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </QueryClientProvider>
  )
}

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuthStore()
  
  if (!user) {
    return <Navigate to="/" replace />
  }
  
  return <>{children}</>
}

export default App