import React from 'react'
import { AlertCircle, Settings, ExternalLink } from 'lucide-react'

interface ConfigErrorProps {
  error: string
}

export const ConfigError: React.FC<ConfigErrorProps> = ({ error }) => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full bg-white rounded-lg shadow-xl p-8">
        <div className="text-center">
          <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100">
            <AlertCircle className="h-6 w-6 text-red-600" />
          </div>
          <h1 className="mt-4 text-2xl font-bold text-gray-900">配置错误</h1>
          <p className="mt-2 text-sm text-gray-600">
            应用程序配置不完整，无法正常运行
          </p>
        </div>

        <div className="mt-8 bg-red-50 border border-red-200 rounded-md p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <Settings className="h-5 w-5 text-red-400" />
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">
                环境变量配置问题
              </h3>
              <div className="mt-2 text-sm text-red-700">
                <pre className="whitespace-pre-wrap bg-red-100 p-2 rounded text-xs">
                  {error}
                </pre>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
            <h3 className="text-sm font-medium text-blue-800 mb-2">
              🚀 GitHub Pages 部署解决方案
            </h3>
            <div className="text-sm text-blue-700 space-y-2">
              <p>1. 在GitHub仓库中设置Secrets：</p>
              <ul className="list-disc list-inside ml-4 space-y-1">
                <li>进入仓库 → Settings → Secrets and variables → Actions</li>
                <li>添加 <code className="bg-blue-100 px-1 rounded">VITE_SUPABASE_URL</code></li>
                <li>添加 <code className="bg-blue-100 px-1 rounded">VITE_SUPABASE_ANON_KEY</code></li>
              </ul>
              <p>2. 重新触发GitHub Actions构建</p>
            </div>
          </div>

          <div className="bg-green-50 border border-green-200 rounded-md p-4">
            <h3 className="text-sm font-medium text-green-800 mb-2">
              💻 本地开发解决方案
            </h3>
            <div className="text-sm text-green-700 space-y-2">
              <p>创建 <code className="bg-green-100 px-1 rounded">.env.local</code> 文件：</p>
              <pre className="bg-green-100 p-2 rounded text-xs">
{`VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key`}
              </pre>
            </div>
          </div>
        </div>

        <div className="mt-8 flex justify-center space-x-4">
          <a
            href="https://github.com/happynocode/app-review-analysis"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            查看仓库
          </a>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
          >
            重新加载
          </button>
        </div>
      </div>
    </div>
  )
} 