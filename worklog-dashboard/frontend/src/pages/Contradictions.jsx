import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getContradictions, resolveContradiction } from '../api';
import { SeverityBadge } from '../components/StatusBadge';

const TYPES = [
  'LOGGED_ON_SICK_LEAVE','LOGGED_ON_VACATION','LOGGED_ON_UNPAID_LEAVE','LOGGED_ON_OTHER_LEAVE',
  'NO_LOG_ON_WORKING_DAY','PARTIAL_DAY_MISMATCH',
  'HURMA_ONLY_NO_REDMINE_USER','EXCLUDED_BUT_HAS_WORKLOG_ACTIVITY','INCLUDED_BUT_NO_SYNCDATA',
];

export default function Contradictions() {
  const [searchParams, setSearchParams] = useSearchParams();
  const now = new Date();
  const defFrom = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;

  const from     = searchParams.get('from')     || defFrom;
  const to       = searchParams.get('to')       || now.toISOString().slice(0,10);
  const type     = searchParams.get('type')     || '';
  const severity = searchParams.get('severity') || '';

  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await getContradictions({ from, to, type: type||undefined, severity: severity||undefined });
      setData(res);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally { setLoading(false); }
  }, [from, to, type, severity]);

  useEffect(() => { load(); }, [load]);

  const setParam = (key, val) => {
    const p = new URLSearchParams(searchParams);
    if (val) p.set(key, val); else p.delete(key);
    setSearchParams(p);
  };

  const resolve = async (id) => {
    await resolveContradiction(id);
    setData((prev) => ({
      ...prev,
      contradictions: prev.contradictions.filter((c) => c.id !== id),
      total: prev.total - 1,
    }));
  };

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Conflicts & Issues</h1>
          <p className="text-sm text-gray-500 mt-0.5">Contradictions detected between Hurma and Redmine data</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input type="date" value={from} onChange={(e) => setParam('from', e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <input type="date" value={to} onChange={(e) => setParam('to', e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <select value={type} onChange={(e) => setParam('type', e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All types</option>
            {TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g,' ')}</option>)}
          </select>
          <select value={severity} onChange={(e) => setParam('severity', e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All severities</option>
            <option value="HIGH">HIGH</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="LOW">LOW</option>
          </select>
          <button onClick={load} className="px-3 py-2 bg-slate-700 text-white text-sm rounded-lg hover:bg-slate-600 transition-colors">
            Refresh
          </button>
        </div>
      </div>

      {loading && <p className="text-gray-400 text-sm">Loading…</p>}
      {error   && <p className="text-red-500 text-sm">{error}</p>}

      {data && !loading && (
        <>
          <p className="text-sm text-gray-500 mb-4">{data.total} active conflict{data.total !== 1 ? 's' : ''}</p>
          <div className="space-y-3">
            {data.contradictions.length === 0 && (
              <div className="text-center py-12 text-gray-400">No conflicts found for this period.</div>
            )}
            {data.contradictions.map((c) => (
              <div key={c.id} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <SeverityBadge severity={c.severity} />
                    <span className="text-xs font-mono text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                      {c.contradiction_type.replace(/_/g,' ')}
                    </span>
                    <span className="text-xs text-gray-400">{c.contradiction_date}</span>
                  </div>
                  <p className="text-sm text-gray-800 font-medium">{c.full_name}</p>
                  <p className="text-sm text-gray-600 mt-0.5">{c.description}</p>
                </div>
                <button
                  onClick={() => resolve(c.id)}
                  className="shrink-0 px-3 py-1.5 bg-green-600 text-white text-xs rounded-lg hover:bg-green-500 transition-colors"
                >
                  Resolve
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
