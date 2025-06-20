import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, AlertTriangle, Trash2 } from 'lucide-react'
import { Button } from './ui/Button'
import { Input } from './ui/Input'

interface DeleteAllDataModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => Promise<void>
  loading: boolean
}

export const DeleteAllDataModal: React.FC<DeleteAllDataModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  loading
}) => {
  const [confirmationText, setConfirmationText] = useState('')
  const [step, setStep] = useState(1)

  const isConfirmationValid = confirmationText === 'DELETE ALL MY DATA'

  const handleConfirm = async () => {
    if (isConfirmationValid) {
      await onConfirm()
      setConfirmationText('')
      setStep(1)
    }
  }

  const handleClose = () => {
    setConfirmationText('')
    setStep(1)
    onClose()
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 backdrop-blur-sm"
          onClick={handleClose}
        />
        
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative bg-[#0A1128] border border-red-500/30 rounded-2xl w-full max-w-md shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-red-500/20">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-red-500/20 rounded-full flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-white">Delete All Data</h2>
                <p className="text-red-400 text-sm">This action cannot be undone</p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="text-white/60 hover:text-white transition-colors"
              disabled={loading}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6">
            {step === 1 && (
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-4"
              >
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
                  <h3 className="text-white font-medium mb-2">⚠️ Warning</h3>
                  <p className="text-white/80 text-sm leading-relaxed">
                    This will permanently delete <strong>ALL</strong> of your data including:
                  </p>
                  <ul className="mt-3 space-y-1 text-white/70 text-sm">
                    <li>• All reports and analysis results</li>
                    <li>• All scraped reviews and data</li>
                    <li>• All themes, quotes, and suggestions</li>
                    <li>• All scraping sessions and history</li>
                  </ul>
                </div>

                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4">
                  <p className="text-yellow-200 text-sm">
                    <strong>This action is irreversible.</strong> Once deleted, your data cannot be recovered.
                  </p>
                </div>

                <div className="flex space-x-3 pt-4">
                  <Button
                    variant="secondary"
                    onClick={handleClose}
                    className="flex-1"
                    disabled={loading}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => setStep(2)}
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                    disabled={loading}
                  >
                    Continue
                  </Button>
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-4"
              >
                <div className="text-center mb-6">
                  <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Trash2 className="w-8 h-8 text-red-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-2">Final Confirmation</h3>
                  <p className="text-white/70 text-sm">
                    To confirm deletion, type the following text exactly:
                  </p>
                </div>

                <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-600">
                  <code className="text-red-400 font-mono text-sm">DELETE ALL MY DATA</code>
                </div>

                <Input
                  type="text"
                  placeholder="Type the confirmation text here..."
                  value={confirmationText}
                  onChange={(e) => setConfirmationText(e.target.value)}
                  className={`${
                    confirmationText && !isConfirmationValid 
                      ? 'border-red-500 focus:ring-red-500' 
                      : isConfirmationValid 
                      ? 'border-green-500 focus:ring-green-500' 
                      : ''
                  }`}
                  disabled={loading}
                />

                {confirmationText && !isConfirmationValid && (
                  <p className="text-red-400 text-sm">
                    Text doesn't match. Please type exactly: "DELETE ALL MY DATA"
                  </p>
                )}

                <div className="flex space-x-3 pt-4">
                  <Button
                    variant="secondary"
                    onClick={() => setStep(1)}
                    className="flex-1"
                    disabled={loading}
                  >
                    Back
                  </Button>
                  <Button
                    onClick={handleConfirm}
                    disabled={!isConfirmationValid || loading}
                    loading={loading}
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white disabled:bg-gray-600"
                    icon={Trash2}
                  >
                    {loading ? 'Deleting...' : 'Delete All Data'}
                  </Button>
                </div>
              </motion.div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}