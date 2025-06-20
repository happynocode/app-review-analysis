import React, { useState, useEffect } from 'react';
import { Card } from './ui/Card';
import { LoadingSpinner } from './LoadingSpinner';
import { supabase } from '../lib/supabase';

interface SystemMetric {
  metric_name: string;
  metric_value: number;
  metric_unit: string;
  created_at: string;
  tags?: any;
}

interface ProcessingStats {
  total_reports: number;
  active_reports: number;
  completed_reports: number;
  failed_reports: number;
  queue_length: number;
  avg_processing_time: number;
}

interface AlertLog {
  alert_type: string;
  severity: string;
  message: string;
  created_at: string;
  resolved: boolean;
}

export const MonitoringDashboard: React.FC = () => {
  const [metrics, setMetrics] = useState<SystemMetric[]>([]);
  const [stats, setStats] = useState<ProcessingStats | null>(null);
  const [alerts, setAlerts] = useState<AlertLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 获取系统指标
  const fetchSystemMetrics = async () => {
    try {
      const { data, error } = await supabase
        .from('system_metrics')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setMetrics(data || []);
    } catch (err) {
      console.error('Error fetching system metrics:', err);
      setError('获取系统指标失败');
    }
  };

  // 获取处理统计
  const fetchProcessingStats = async () => {
    try {
      const { data, error } = await supabase
        .from('monitoring_dashboard')
        .select('*')
        .single();

      if (error) throw error;
      setStats(data);
    } catch (err) {
      console.error('Error fetching processing stats:', err);
      setError('获取处理统计失败');
    }
  };

  // 获取告警日志
  const fetchAlerts = async () => {
    try {
      const { data, error } = await supabase
        .from('alert_logs')
        .select('*')
        .eq('resolved', false)
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      setAlerts(data || []);
    } catch (err) {
      console.error('Error fetching alerts:', err);
    }
  };

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      await Promise.all([
        fetchSystemMetrics(),
        fetchProcessingStats(),
        fetchAlerts()
      ]);
      setIsLoading(false);
    };

    loadData();

    // 每30秒刷新一次数据
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  const formatMetricValue = (value: number, unit: string) => {
    if (unit === 'percentage') return `${value.toFixed(1)}%`;
    if (unit === 'seconds') return `${value.toFixed(2)}s`;
    if (unit === 'milliseconds') return `${value.toFixed(0)}ms`;
    if (unit === 'count') return value.toString();
    return `${value} ${unit}`;
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'text-red-600 bg-red-50';
      case 'high': return 'text-orange-600 bg-orange-50';
      case 'medium': return 'text-yellow-600 bg-yellow-50';
      case 'low': return 'text-blue-600 bg-blue-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
        <p className="text-red-600">{error}</p>
        <button 
          onClick={() => window.location.reload()}
          className="mt-2 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
        >
          重新加载
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 系统概览 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats && (
          <>
            <Card className="p-4">
              <div className="text-sm text-gray-600">总报告数</div>
              <div className="text-2xl font-bold text-blue-600">{stats.total_reports}</div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-gray-600">处理中</div>
              <div className="text-2xl font-bold text-orange-600">{stats.active_reports}</div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-gray-600">已完成</div>
              <div className="text-2xl font-bold text-green-600">{stats.completed_reports}</div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-gray-600">队列长度</div>
              <div className="text-2xl font-bold text-purple-600">{stats.queue_length}</div>
            </Card>
          </>
        )}
      </div>

      {/* 告警信息 */}
      {alerts.length > 0 && (
        <Card className="p-4">
          <h3 className="text-lg font-semibold mb-4 text-red-600">🚨 活跃告警</h3>
          <div className="space-y-2">
            {alerts.map((alert, index) => (
              <div 
                key={index}
                className={`p-3 rounded-lg ${getSeverityColor(alert.severity)}`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-medium">{alert.alert_type}</div>
                    <div className="text-sm">{alert.message}</div>
                  </div>
                  <div className="text-xs opacity-75">
                    {new Date(alert.created_at).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 性能指标 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-4">
          <h3 className="text-lg font-semibold mb-4">📊 实时性能指标</h3>
          <div className="space-y-3">
            {metrics.slice(0, 8).map((metric, index) => (
              <div key={index} className="flex justify-between items-center">
                <span className="text-sm text-gray-600">{metric.metric_name}</span>
                <span className="font-medium">
                  {formatMetricValue(metric.metric_value, metric.metric_unit)}
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="text-lg font-semibold mb-4">⚡ 系统状态</h3>
          <div className="space-y-3">
            {stats && (
              <>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">平均处理时间</span>
                  <span className="font-medium">
                    {stats.avg_processing_time ? `${stats.avg_processing_time.toFixed(1)}分钟` : 'N/A'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">成功率</span>
                  <span className="font-medium text-green-600">
                    {stats.total_reports > 0 
                      ? `${((stats.completed_reports / stats.total_reports) * 100).toFixed(1)}%`
                      : 'N/A'
                    }
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">失败率</span>
                  <span className="font-medium text-red-600">
                    {stats.total_reports > 0 
                      ? `${((stats.failed_reports / stats.total_reports) * 100).toFixed(1)}%`
                      : 'N/A'
                    }
                  </span>
                </div>
              </>
            )}
          </div>
        </Card>
      </div>

      {/* 最近指标趋势 */}
      <Card className="p-4">
        <h3 className="text-lg font-semibold mb-4">📈 最近指标变化</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left p-2">指标名称</th>
                <th className="text-left p-2">数值</th>
                <th className="text-left p-2">单位</th>
                <th className="text-left p-2">时间</th>
              </tr>
            </thead>
            <tbody>
              {metrics.slice(0, 10).map((metric, index) => (
                <tr key={index} className="border-b">
                  <td className="p-2">{metric.metric_name}</td>
                  <td className="p-2 font-medium">{metric.metric_value}</td>
                  <td className="p-2">{metric.metric_unit}</td>
                  <td className="p-2 text-gray-500">
                    {new Date(metric.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}; 