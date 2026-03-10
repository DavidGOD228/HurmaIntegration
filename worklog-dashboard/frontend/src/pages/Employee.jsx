import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { getEmployeeDetails } from '../api';
import StatusBadge from '../components/StatusBadge';

function fmt(n) { return (parseFloat(n) || 0).toFixed(1); }

function DeltaCell({ delta }) {
  const d = parseFloat(delta) || 0;
  const bg = d < -0.5 ? 'bg-yellow-50 text-yellow-800'
           : d >  0.5 ? 'bg-orange-50 text-orange-800'
           : 'bg-green-50 text-green-800';
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-mono font-semibold ${bg}`}>
      {d >= 0 ? '+' : ''}{d.toFixed(1)}h
    </span>
  );
}

export default function Employee() {
  const { id }                          = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const now = new Date();
  const defFrom = searchParams.get('from') || `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
  const defTo   = searchParams.get('to')   || now.toISOString().slice(0,10);
  const [from, setFrom] = useState(defFrom);
  const [to,   setTo]   = useState(defTo);

  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await getEmployeeDetails(id, { from, to });
      setData(res);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally { setLoading(false); }
  }, [id, from, to]);

  useEffect(() => { load(); }, [load]);

  const apply = () => {
    const p = new URLSearchParams(searchParams);
    p.set('from', from); p.set('to', to);
    setSearchParams(p);
    load();
  };

  if (loading) return <div className="p-6 text-gray-400">Loading…</div>;
  if (error)   return <div className="p-6 text-red-500">{error}</div>;
  if (!data)   return null;

  const { employee, period, totals, days, absences } = data;

  return (
    <div className="p-6">
      {/* Back + header */}
      <div className="mb-4">
        <Link to="/" className="text-sm text-blue-600 hover:underline">← Daily overview</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">{employee.full_name}</h1>
        <p className="text-sm text-gray-500">{employee.email} · {employee.department || 'No dept'} · {employee.position || ''}</p>
        <p className="text-sm text-gray-500">
          Monitoring: <span className="font-medium capitalize">{employee.monitoring_mode?.replace(/_/g,' ')}</span>
          {employee.redmine_user_id ? ` · Redmine #${employee.redmine_user_id}` : ' · ⚠ No Redmine mapping'}
        </p>
      </div>

      {/* Period picker */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <label className="text-sm text-gray-600">From</label>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <label className="text-sm text-gray-600">To</label>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <button onClick={apply} className="px-3 py-1.5 bg-slate-700 text-white text-sm rounded-lg hover:bg-slate-600 transition-colors">
          Apply
        </button>
      </div>

      {/* Period totals */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Expected', value: `${fmt(totals.expectedHours)}h` },
          { label: 'Logged',   value: `${fmt(totals.actualHours)}h` },
          { label: 'Delta',    value: `${totals.deltaHours >= 0 ? '+' : ''}${fmt(totals.deltaHours)}h`,
            color: totals.deltaHours < -1 ? 'text-yellow-700' : totals.deltaHours > 1 ? 'text-orange-700' : 'text-green-700' },
          { label: 'Conflicts',value: totals.contradictions, color: totals.contradictions > 0 ? 'text-red-600' : 'text-gray-800' },
        ].map((c) => (
          <div key={c.label} className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
            <p className="text-xs text-gray-500 uppercase tracking-wide">{c.label}</p>
            <p className={`text-2xl font-bold mt-1 ${c.color || 'text-gray-800'}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Absences summary */}
      {absences.length > 0 && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-xl">
          <h3 className="text-sm font-semibold text-blue-800 mb-2">Leave in period</h3>
          <div className="space-y-1">
            {absences.map((a, i) => (
              <p key={i} className="text-sm text-blue-700">
                <span className="capitalize font-medium">{a.absence_type.replace(/_/g,' ')}</span>
                {' '}— {a.date_from} to {a.date_to}
                {a.hours ? ` (${a.hours}h)` : ''}
                {!a.is_approved && ' — ⚠ not approved'}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Day-by-day table */}
      <h2 className="text-lg font-semibold text-gray-800 mb-3">Day-by-Day Breakdown</h2>
      <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              {['Date','Expected','Logged','Delta','Leave','Conflicts','Status'].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-100">
            {days.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">No data for this period. Run a sync first.</td></tr>
            ) : days.map((d, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-4 py-2 font-mono text-xs text-gray-600">{d.summary_date}</td>
                <td className="px-4 py-2">{fmt(d.expected_hours)}h</td>
                <td className="px-4 py-2">{fmt(d.actual_hours)}h</td>
                <td className="px-4 py-2"><DeltaCell delta={d.delta_hours} /></td>
                <td className="px-4 py-2 text-xs text-blue-700 capitalize">{d.leave_type?.replace(/_/g,' ') || '—'}</td>
                <td className="px-4 py-2">
                  {d.contradiction_count > 0
                    ? <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-500 text-white text-xs font-bold">{d.contradiction_count}</span>
                    : '—'}
                </td>
                <td className="px-4 py-2"><StatusBadge status={d.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
