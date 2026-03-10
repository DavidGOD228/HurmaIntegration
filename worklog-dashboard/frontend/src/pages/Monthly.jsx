import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getMonthly } from '../api';
import StatusBadge from '../components/StatusBadge';
import SortableTable from '../components/SortableTable';

function fmt(n) { return (parseFloat(n) || 0).toFixed(1); }

function DeltaCell({ delta }) {
  const d = parseFloat(delta) || 0;
  const color = d < -1 ? 'text-yellow-700 font-semibold'
              : d >  1 ? 'text-orange-700 font-semibold'
              : 'text-green-700';
  return <span className={color}>{d >= 0 ? '+' : ''}{d.toFixed(1)}h</span>;
}

export default function Monthly() {
  const navigate        = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const now    = new Date();
  const defMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const month           = searchParams.get('month') || defMonth;
  const onlyProblematic = searchParams.get('onlyProblematic') === '1';

  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await getMonthly({ month, onlyProblematic: onlyProblematic ? 1 : 0 });
      setData(res);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally { setLoading(false); }
  }, [month, onlyProblematic]);

  useEffect(() => { load(); }, [load]);

  const setParam = (key, val) => {
    const p = new URLSearchParams(searchParams);
    if (val) p.set(key, val); else p.delete(key);
    setSearchParams(p);
  };

  const columns = [
    { key: 'full_name',          label: 'Employee' },
    { key: 'expected_hours',     label: 'Expected',     render: (r) => `${fmt(r.expected_hours)}h` },
    { key: 'actual_hours',       label: 'Logged',       render: (r) => `${fmt(r.actual_hours)}h` },
    { key: 'delta_hours',        label: 'Delta',        render: (r) => <DeltaCell delta={r.delta_hours} /> },
    { key: 'leave_days',         label: 'Leave days',   render: (r) => r.leave_days || 0 },
    { key: 'underlogged_days',   label: 'Under days',   render: (r) => r.underlogged_days > 0 ? <span className="text-yellow-700 font-semibold">{r.underlogged_days}</span> : '0' },
    { key: 'contradiction_count',label: 'Conflicts',    render: (r) => r.contradiction_count > 0 ? <span className="text-red-600 font-semibold">{r.contradiction_count}</span> : '0' },
    { key: 'ok_days',            label: 'OK days',      render: (r) => <span className="text-green-700">{r.ok_days || 0}</span> },
  ];

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Monthly Overview</h1>
          <p className="text-sm text-gray-500 mt-0.5">Aggregated hours and status for the selected month</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="month"
            value={month}
            onChange={(e) => setParam('month', e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none">
            <input type="checkbox" checked={onlyProblematic} onChange={(e) => setParam('onlyProblematic', e.target.checked ? '1' : '')} className="rounded" />
            Problems only
          </label>
          <button onClick={load} className="px-3 py-2 bg-slate-700 text-white text-sm rounded-lg hover:bg-slate-600 transition-colors">
            Refresh
          </button>
        </div>
      </div>

      {loading && <p className="text-gray-400 text-sm">Loading…</p>}
      {error   && <p className="text-red-500 text-sm">{error}</p>}
      {data && !loading && (
        <>
          {/* Totals row */}
          <div className="mb-4 p-4 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-600">
            <span className="font-semibold">{data.employees.length}</span> employees ·
            Total expected: <span className="font-semibold">{fmt(data.employees.reduce((s,r) => s + parseFloat(r.expected_hours||0), 0))}h</span> ·
            Total logged: <span className="font-semibold">{fmt(data.employees.reduce((s,r) => s + parseFloat(r.actual_hours||0), 0))}h</span>
          </div>
          <SortableTable
            columns={columns}
            rows={data.employees}
            onRowClick={(row) => navigate(`/employees/${row.employee_id}?from=${month}-01`)}
            emptyMessage="No data for this month. Run a sync first."
          />
        </>
      )}
    </div>
  );
}
