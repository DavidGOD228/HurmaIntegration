import { NavLink, useNavigate } from 'react-router-dom';
import { triggerSync } from '../api';
import { useState } from 'react';

const nav = [
  { to: '/',           label: 'Daily',    icon: '📅' },
  { to: '/monthly',    label: 'Monthly',  icon: '📆' },
  { to: '/settings',   label: 'Settings', icon: '⚙️' },
  { to: '/contradictions', label: 'Issues', icon: '⚠️' },
];

export default function Layout({ children }) {
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');

  const handleSync = async () => {
    setSyncing(true);
    setSyncMsg('');
    try {
      const now   = new Date();
      const from  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2,'0')}-01`;
      const today = now.toISOString().slice(0, 10);
      await triggerSync({ type: 'all', from, to: today });
      setSyncMsg('Sync started — refresh in a minute');
    } catch (e) {
      setSyncMsg('Sync failed: ' + (e.response?.data?.error || e.message));
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMsg(''), 4000);
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
          <button
            onClick={handleSync}
            disabled={syncing}
            className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:text-blue-300 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {syncing ? 'Syncing…' : '↻ Sync Now'}
          </button>
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
