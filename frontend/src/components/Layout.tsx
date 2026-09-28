import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { api, type Summary } from '../api';
import { useAuth } from '../auth';
import { useToast } from './ui';

export function Logo() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="6" fill="var(--ink)" />
      <path d="M4 18h7l3-9 4 15 3-9h7" fill="none" stroke="var(--signal)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function getTheme(): 'light' | 'dark' {
  try {
    const saved = localStorage.getItem('contractrift-theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* storage unavailable */
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme = getTheme()) {
  document.documentElement.dataset.theme = theme;
}

export function Layout() {
  const { user, can, refresh, isDemoUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState(getTheme());
  const loc = useLocation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const summary = useQuery({ queryKey: ['summary'], queryFn: () => api.get<Summary>('/summary'), refetchInterval: 15_000 });

  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem('contractrift-theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const s = summary.data;
  const openDrift = s ? s.openDrift.breaking + s.openDrift.warning + s.openDrift.info : 0;

  async function logout() {
    try {
      await api.post('/auth/logout');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
    qc.clear();
    await refresh();
    nav('/login');
  }

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Main navigation">
        <NavLink to="/" className="brand">
          <Logo />
          <div>
            <div className="brand-name">ContractRift</div>
            <div className="brand-tag">dependency drift</div>
          </div>
        </NavLink>
        <nav className="nav">
          <NavLink to="/" end>
            Overview
          </NavLink>
          <NavLink to="/monitors">Monitors {s ? <span className="count">{s.monitors.total}</span> : null}</NavLink>
          <NavLink to="/drift">Drift inbox {openDrift ? <span className="count">{openDrift}</span> : null}</NavLink>
          <NavLink to="/incidents">Incidents {s?.openIncidents ? <span className="count">{s.openIncidents}</span> : null}</NavLink>
          <div className="nav-label">Settings</div>
          {can('admin') ? <NavLink to="/settings/channels">Notifications</NavLink> : null}
          {can('admin') ? <NavLink to="/settings/users">Users</NavLink> : null}
          <NavLink to="/settings/tokens">API tokens</NavLink>
          {can('admin') ? <NavLink to="/settings/audit">Audit log</NavLink> : null}
          <NavLink to="/settings/account">Account</NavLink>
        </nav>
        <div className="sidebar-foot">
          <div>
            <div style={{ fontWeight: 600 }}>{user?.name}</div>
            <div className="cell-sub">
              {user?.email} · {user?.role}
            </div>
          </div>
          <div className="actions">
            <button className="btn small" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
              {theme === 'dark' ? 'Light' : 'Dark'} mode
            </button>
            <button className="btn small ghost" onClick={logout}>
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <div>
        <div className="topbar">
          <NavLink to="/" className="brand" style={{ padding: 0 }}>
            <Logo />
            <span className="brand-name">ContractRift</span>
          </NavLink>
          <button className="btn small" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            Menu
          </button>
        </div>
        <main className="main" id="main">
          {isDemoUser ? (
            <div className="note" style={{ marginBottom: 18 }}>
              <strong>Public demo (read-only).</strong> These monitors watch real public services. Run ContractRift yourself to monitor your
              own APIs:{' '}
              <a href="https://github.com/ahmedgcompany-cyber/contractrift" target="_blank" rel="noreferrer">
                github.com/ahmedgcompany-cyber/contractrift
              </a>
            </div>
          ) : null}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
