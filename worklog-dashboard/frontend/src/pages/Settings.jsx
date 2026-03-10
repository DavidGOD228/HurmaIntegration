import { useState, useEffect, useCallback } from 'react';
import { getSettingsEmployees, patchEmployee, getUnresolvedMappings, patchMapping } from '../api';
import StatusBadge from '../components/StatusBadge';

const MODE_OPTIONS = [
  { value: 'included',                         label: 'Included' },
  { value: 'excluded',                          label: 'Excluded' },
  { value: 'ignored_fulltime_external_project', label: 'Ext. project' },
];

const MODE_COLORS = {
  included:                         'bg-green-100 text-green-800',
  excluded:                         'bg-gray-100 text-gray-600',
  ignored_fulltime_external_project:'bg-blue-100 text-blue-700',
};

function ModeSelect({ current, onChange }) {
  return (
    <select
      value={current}
      onChange={(e) => onChange(e.target.value)}
      className="border border-gray-200 rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
    >
      {MODE_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export default function Settings() {
  const [employees, setEmployees] = useState([]);
  const [total,     setTotal]     = useState(0);
  const [page,      setPage]      = useState(1);
  const [search,    setSearch]    = useState('');
  const [filterMode, setFilterMode] = useState('');
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [saving,    setSaving]    = useState({});
  const [pending,   setPending]   = useState({});  // unsaved changes
  const [mappings,  setMappings]  = useState([]);

  const LIMIT = 50;

  const loadEmployees = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await getSettingsEmployees({
        search, mode: filterMode, page, limit: LIMIT,
      });
      setEmployees(res.employees);
      setTotal(res.total);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally { setLoading(false); }
  }, [search, filterMode, page]);

  useEffect(() => { loadEmployees(); }, [loadEmployees]);

  useEffect(() => {
    getUnresolvedMappings().then((r) => setMappings(r.queue || [])).catch(() => {});
  }, []);

  const markPending = (id, key, val) => {
    setPending((prev) => ({ ...prev, [id]: { ...prev[id], [key]: val } }));
  };

  const saveEmployee = async (emp) => {
    const changes = pending[emp.id];
    if (!changes) return;
    setSaving((s) => ({ ...s, [emp.id]: true }));
    try {
      await patchEmployee(emp.id, changes);
      setPending((prev) => { const n = {...prev}; delete n[emp.id]; return n; });
      await loadEmployees();
    } catch (e) {
      alert('Save failed: ' + (e.response?.data?.error || e.message));
    } finally {
      setSaving((s) => { const n = {...s}; delete n[emp.id]; return n; });
    }
  };

  const confirmMapping = async (m) => {
    const redmineId = prompt(`Redmine user ID for "${m.hurma_full_name}":`);
    if (!redmineId) return;
    await patchMapping(m.id, { status: 'confirmed', redmine_user_id: parseInt(redmineId, 10) });
    setMappings((prev) => prev.filter((x) => x.id !== m.id));
  };

  const rejectMapping = async (m) => {
    await patchMapping(m.id, { status: 'rejected' });
    setMappings((prev) => prev.filter((x) => x.id !== m.id));
  };

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Monitoring Settings</h1>
      <p className="text-sm text-gray-500 mb-6">Choose which employees are included in the worklog dashboard.</p>

      {/* Unmapped queue */}
      {mappings.length > 0 && (
        <div className="mb-6 p-4 bg-purple-50 border border-purple-200 rounded-xl">
          <h2 className="text-sm font-semibold text-purple-800 mb-3">
            ⚠ {mappings.length} employee{mappings.length > 1 ? 's' : ''} need Redmine mapping
          </h2>
          <div className="space-y-2">
            {mappings.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-4 text-sm">
                <span className="text-purple-700 font-medium">{m.hurma_full_name}</span>
                <span className="text-purple-500 text-xs">{m.hurma_email}</span>
                <div className="flex gap-2">
                  <button onClick={() => confirmMapping(m)} className="px-2 py-1 bg-purple-600 text-white rounded text-xs hover:bg-purple-500">Map</button>
                  <button onClick={() => rejectMapping(m)} className="px-2 py-1 bg-gray-200 text-gray-600 rounded text-xs hover:bg-gray-300">Skip</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="search"
          placeholder="Search by name or email…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          value={filterMode}
          onChange={(e) => { setFilterMode(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All modes</option>
          {MODE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <span className="text-sm text-gray-400">{total} total</span>
      </div>

      {error   && <p className="text-red-500 text-sm mb-4">{error}</p>}
      {loading && <p className="text-gray-400 text-sm">Loading…</p>}

      {!loading && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                {['Employee','Email','Dept','Redmine','Mode','Note',''].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {employees.map((emp) => {
                const edits   = pending[emp.id] || {};
                const mode    = edits.monitoring_mode ?? emp.monitoring_mode ?? 'excluded';
                const note    = edits.note            ?? emp.note            ?? '';
                const isDirty = !!pending[emp.id];
                return (
                  <tr key={emp.id} className={isDirty ? 'bg-blue-50' : 'hover:bg-gray-50'}>
                    <td className="px-4 py-3 font-medium text-gray-800">{emp.full_name}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{emp.email || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{emp.department || '—'}</td>
                    <td className="px-4 py-3">
                      {emp.redmine_user_id
                        ? <span className="text-green-700 text-xs font-medium">#{emp.redmine_user_id}</span>
                        : <span className="text-purple-600 text-xs">unmapped</span>}
                    </td>
                    <td className="px-4 py-3">
                      <ModeSelect current={mode} onChange={(v) => markPending(emp.id, 'monitoring_mode', v)} />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        value={note}
                        onChange={(e) => markPending(emp.id, 'note', e.target.value)}
                        placeholder="Optional note"
                        className="border border-gray-200 rounded px-2 py-1 text-xs w-40 focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </td>
                    <td className="px-4 py-3">
                      {isDirty && (
                        <button
                          onClick={() => saveEmployee(emp)}
                          disabled={saving[emp.id]}
                          className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-500 disabled:opacity-50 transition-colors"
                        >
                          {saving[emp.id] ? 'Saving…' : 'Save'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button onClick={() => setPage((p) => Math.max(1, p-1))} disabled={page === 1}
            className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-40">
            Previous
          </button>
          <span className="text-sm text-gray-600">{page} / {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p+1))} disabled={page === totalPages}
            className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-40">
            Next
          </button>
        </div>
      )}
    </div>
  );
}
