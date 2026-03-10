import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getDaily } from '../api';
import StatusBadge from '../components/StatusBadge';
import SortableTable from '../components/SortableTable';

function fmt(n) { return (parseFloat(n) || 0).toFixed(1); }

function DeltaCell({ delta }) {
  const d = parseFloat(delta) || 0;
  const color = d < -0.5 ? 'text-yellow-700 font-semibold'
              : d >  0.5 ? 'text-orange-700 font-semibold'
              : 'text-green-700';
  return <span className={color}>{d >= 0 ? '+' : ''}{d.toFixed(1)}h</span>;
}

function StatCard({ label, value, color = 'bg-white' }) {
  return (
    <div className={`rounded-xl p-4 shadow-sm border border-gray-200 ${color}`}>
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-3xl font-bold text-gray-800 mt-1">{value}</p>
    </div>
  );
}

export default function Daily() {
  const navigate        = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const todayStr        = new Date().toISOString().slice(0, 10);
  const date            = searchParams.get('date') || todayStr;
  const onlyProblematic = searchParams.get('onlyProblematic') === '1';
  const onlyContradictions = searchParams.get('onlyContradictions') === '1';

  const [data, setData]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getDaily({ date, onlyProblematic: onlyProblematic ? 1 : 0, onlyContradictions: onlyContradictions ? 1 : 0 });
      setData(res);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, [date, onlyProblematic, onlyContradictions]);

  useEffect(() => { load(); }, [load]);

  const setParam = (key, val) => {
    const p = new URLSearchParams(searchParams);
    if (val) p.set(key, val); else p.delete(key);
    setSearchParams(p);
  };

  const columns = [
    { key: 'full_name',           label: 'Employee' },
    { key: 'expected_hours',      label: 'Expected',       render: (r) => `${fmt(r.expected_hours)}h` },
    { key: 'actual_hours',        label: 'Logged',         render: (r) => `${fmt(r.actual_hours)}h` },
    { key: 'delta_hours',         label: 'Delta',          render: (r) => <DeltaCell delta={r.delta_hours} /> },
    { key: 'leave_type',          label: 'Leave',          render: (r) => r.leave_type ? <span className="capitalize text-blue-700 text-xs">{r.leave_type.replace('_',' ')}</span> : '—' },
    { key: 'contradiction_count', label: 'Issues',         render: (r) => r.contradiction_count > 0 ? <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-500 text-white text-xs font-bold">{r.contradiction_count}</span> : '—' },
    { key: 'status',              label: 'Status',         render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Daily Overview</h1>
          <p className="text-sm text-gray-500 mt-0.5">Attendance & worklog status per employee</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="date"
            value={date}
            onChange={(e) => setParam('date', e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none">
            <input type="checkbox" checked={onlyProblematic} onChange={(e) => setParam('onlyProblematic', e.target.checked ? '1' : '')} className="rounded" />
            Problems only
          </label>
          <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none">
            <input type="checkbox" checked={onlyContradictions} onChange={(e) => setParam('onlyContradictions', e.target.checked ? '1' : '')} className="rounded" />
            Conflicts only
          </label>
          <button onClick={load} className="px-3 py-2 bg-slate-700 text-white text-sm rounded-lg hover:bg-slate-600 transition-colors">
            Refresh
          </button>
        </div>
      </div>

      {/* Stat cards */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
          <StatCard label="Monitored"     value={data.totals.monitored} />
          <StatCard label="OK"            value={data.totals.ok}            color="bg-green-50" />
          <StatCard label="On Leave"      value={data.totals.onLeave}        color="bg-blue-50" />
          <StatCard label="Underlogged"   value={data.totals.underlogged}    color="bg-yellow-50" />
          <StatCard label="Overlogged"    value={data.totals.overlogged}     color="bg-orange-50" />
          <StatCard label="Conflicts"     value={data.totals.contradictions} color="bg-red-50" />
          <StatCard label="Unmapped"      value={data.totals.unmapped}       color="bg-purple-50" />
        </div>
      )}

      {/* Table */}
      {loading && <p className="text-gray-400 text-sm">Loading…</p>}
      {error   && <p className="text-red-500 text-sm">{error}</p>}
      {data && !loading && (
        <SortableTable
          columns={columns}
          rows={data.employees}
          onRowClick={(row) => navigate(`/employees/${row.employee_id}`)}
          emptyMessage="No monitored employees for this date."
        />
      )}
    </div>
  );
}
