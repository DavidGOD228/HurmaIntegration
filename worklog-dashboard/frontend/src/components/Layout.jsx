import { NavLink } from 'react-router-dom';
import { triggerSync, getVersion } from '../api';
import { useState, useEffect } from 'react';

const nav = [
  { to: '/',           label: 'Daily',    icon: '📅' },
  { to: '/monthly',    label: 'Monthly',  icon: '📆' },
  { to: '/settings',   label: 'Settings', icon: '⚙️' },
  { to: '/contradictions', label: 'Issues', icon: '⚠️' },
];

export default function Layout({ children }) {
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [version, setVersion] = useState('');

  useEffect(() => {
    getVersion().then((d) => setVersion(d.version || '')).catch(() => {});
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    setSyncMsg('');
    try {
      const now   = new Date();
      const today = now.toISOString().slice(0, 10);
      const fromDate = new Date(now);
      fromDate.setDate(fromDate.getDate() - 90);
      const from = fromDate.toISOString().slice(0, 10);
      const res = await triggerSync({ type: 'all', from, to: today, wait: true });
      if (res.status === 'success') {
        setSyncMsg('Synced — refreshing…');
        window.location.reload();
      } else {
        setSyncMsg(res.error || 'Sync failed');
      }
    } catch (e) {
      setSyncMsg('Sync failed: ' + (e.response?.data?.error || e.message));
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMsg(''), 6000);
    }
  };

  return (
    <div className="flex h-screen bg-gray-100 font-sans">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 bg-slate-800 text-slate-100 flex flex-col">
        <div className="px-6 py-5 border-b border-slate-700">
          <h1 className="text-lg font-bold tracking-tight">Worklog</h1>
          <p className="text-xs text-slate-400 mt-0.5">Hurma × Redmine</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`
              }
            >
              <span>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-4 border-t border-slate-700">
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:text-blue-300 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {syncing ? 'Syncing…' : '↻ Sync Now'}
            </button>
            {version && (
              <span className="text-xs text-slate-500 shrink-0">v{version}</span>
            )}
          </div>
          {syncMsg && (
            <p className="mt-2 text-xs text-slate-400 text-center">{syncMsg}</p>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
