import { useState, useEffect, useCallback } from 'react';
import { getSettingsEmployees, patchEmployee } from '../api';

const MODE_OPTIONS = [
  { value: 'included',                         label: 'Included' },
  { value: 'excluded',                          label: 'Excluded' },
  { value: 'ignored_fulltime_external_project', label: 'Ext. project' },
];

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
  const [includeInactive, setIncludeInactive] = useState(false);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [saving,    setSaving]    = useState({});
  const [pending,   setPending]   = useState({});  // unsaved changes

  const LIMIT = 50;

  const loadEmployees = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await getSettingsEmployees({
        search, mode: filterMode, page, limit: LIMIT,
        active_only: includeInactive ? 0 : 1,
      });
      setEmployees(res.employees);
      setTotal(res.total);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally { setLoading(false); }
  }, [search, filterMode, page, includeInactive]);

  useEffect(() => { loadEmployees(); }, [loadEmployees]);

  const markPending = (id, key, val) => {
    setPending((prev) => ({ ...prev, [id]: { ...prev[id], [key]: val } }));
  };

  const saveEmployee = async (emp) => {
    const changes = pending[emp.id];
    if (!changes) return;
    const sanitized = { ...changes };
    if (sanitized.redmine_user_id !== undefined) {
      const v = sanitized.redmine_user_id;
      sanitized.redmine_user_id = (v === null || v === '') ? null : (typeof v === 'number' ? v : parseInt(v, 10));
      if (sanitized.redmine_user_id !== null && isNaN(sanitized.redmine_user_id)) {
        alert('Redmine ID must be a number');
        return;
      }
    }
    setSaving((s) => ({ ...s, [emp.id]: true }));
    try {
      await patchEmployee(emp.id, sanitized);
      setPending((prev) => { const n = {...prev}; delete n[emp.id]; return n; });
      await loadEmployees();
    } catch (e) {
      alert('Save failed: ' + (e.response?.data?.error || e.message));
    } finally {
      setSaving((s) => { const n = {...s}; delete n[emp.id]; return n; });
    }
  };

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Monitoring Settings</h1>
      <p className="text-sm text-gray-500 mb-6">Choose which employees are included in the worklog dashboard. Add Redmine user ID directly in the table for unmapped employees.</p>

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
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => { setIncludeInactive(e.target.checked); setPage(1); }}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          Include inactive (left/fired)
        </label>
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
                const redmineId = edits.redmine_user_id !== undefined
                  ? (edits.redmine_user_id === null || edits.redmine_user_id === '' ? '' : String(edits.redmine_user_id))
                  : (emp.redmine_user_id ? String(emp.redmine_user_id) : '');
                const isDirty = !!Object.keys(pending[emp.id] || {}).length;
                return (
                  <tr key={emp.id} className={isDirty ? 'bg-blue-50' : 'hover:bg-gray-50'}>
                    <td className="px-4 py-3 font-medium text-gray-800">{emp.full_name}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{emp.email || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{emp.department || '—'}</td>
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        value={redmineId}
                        onChange={(e) => {
                          const v = e.target.value.trim();
                          const num = v === '' ? null : parseInt(v, 10);
                          markPending(emp.id, 'redmine_user_id', v === '' ? null : (isNaN(num) ? v : num));
                        }}
                        placeholder="ID"
                        className="border border-gray-200 rounded px-2 py-1 text-xs w-16 focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
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
