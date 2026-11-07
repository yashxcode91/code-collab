import { useState, useEffect } from 'react';
import { ApiResponse, HealthCheckResponse } from '@codecollab/shared';
import { Activity, Server, Database, Radio, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';

export default function App() {
  const [health, setHealth] = useState<HealthCheckResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const checkHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/health');
      if (!res.ok) {
        throw new Error(`Server returned HTTP ${res.status}`);
      }
      const json: ApiResponse<HealthCheckResponse> = await res.json();
      if (json.success && json.data) {
        setHealth(json.data);
      } else {
        throw new Error(json.error?.message || 'Failed to retrieve server health');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown network error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkHealth();
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
      <div className="max-w-xl w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between pb-6 border-b border-slate-800">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              <span className="text-blue-500 font-mono">&lt;/&gt;</span> CodeCollab Studio
            </h1>
            <p className="text-sm text-slate-400 mt-1">Real-time developer platform</p>
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
            Day 1 Foundation
          </span>
        </div>

        {/* Backend Connectivity Status */}
        <div className="mt-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
              <Server className="w-4 h-4 text-slate-400" /> Backend API Status
            </h2>
            <button
              onClick={checkHealth}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          {loading && !health ? (
            <div className="bg-slate-950/60 rounded-xl p-6 border border-slate-800/80 flex items-center justify-center gap-3 text-slate-400">
              <Activity className="w-5 h-5 animate-pulse text-blue-400" />
              <span>Connecting to backend via Vite proxy...</span>
            </div>
          ) : error ? (
            <div className="bg-red-950/30 border border-red-800/50 rounded-xl p-5 text-red-300 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">Connection Error</p>
                <p className="text-sm text-red-400/80 mt-1">{error}</p>
                <p className="text-xs text-slate-400 mt-2">Make sure apps/server is running on port 4000!</p>
              </div>
            </div>
          ) : health ? (
            <div className="bg-slate-950/80 rounded-xl p-5 border border-slate-800/80 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">System Status</span>
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {health.status.toUpperCase()}
                </span>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">Server Uptime</span>
                <span className="font-mono text-slate-200">{health.uptime}s</span>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">Last Checked</span>
                <span className="font-mono text-xs text-slate-400">
                  {new Date(health.timestamp).toLocaleTimeString()}
                </span>
              </div>

              <div className="pt-3 border-t border-slate-800/80">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5">
                  Infrastructure Services
                </p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center justify-between bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/60">
                    <span className="flex items-center gap-1.5 text-slate-300">
                      <Database className="w-3.5 h-3.5 text-slate-400" /> PostgreSQL
                    </span>
                    <span className={health.services.database ? 'text-emerald-400' : 'text-amber-400'}>
                      {health.services.database ? 'Connected' : 'Pending'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/60">
                    <span className="flex items-center gap-1.5 text-slate-300">
                      <Radio className="w-3.5 h-3.5 text-slate-400" /> Redis Cache
                    </span>
                    <span className={health.services.redis ? 'text-emerald-400' : 'text-amber-400'}>
                      {health.services.redis ? 'Connected' : 'Pending'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer info */}
        <div className="mt-6 pt-4 border-t border-slate-800 text-xs text-center text-slate-500">
          Vite (5173) ⇄ Express API (4000) ⇄ Shared Contracts (@codecollab/shared)
        </div>
      </div>
    </div>
  );
}
