import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

const ICONS: Record<string, ReactNode> = {
  dashboard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  pipeline: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="5" cy="6" r="2.2" />
      <circle cx="12" cy="18" r="2.2" />
      <circle cx="19" cy="6" r="2.2" />
      <path d="M7 7.3 10.3 16M17 7.3 13.7 16" />
    </svg>
  ),
  leads: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 20c0-3.3 3.6-5 8-5s8 1.7 8 5" />
      <circle cx="12" cy="8" r="4" />
    </svg>
  ),
  reports: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M15 3v4h4M9 12h6M9 16h6" />
    </svg>
  ),
  scan: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M13 2 4 14h6l-1 8 9-12h-6z" />
    </svg>
  ),
  sources: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <ellipse cx="12" cy="5.5" rx="8" ry="3" />
      <path d="M4 5.5V12c0 1.7 3.6 3 8 3s8-1.3 8-3V5.5M4 12v6.5c0 1.7 3.6 3 8 3s8-1.3 8-3V12" />
    </svg>
  ),
  profile: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5 20c1.2-4 4-6 7-6s5.8 2 7 6" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="12" r="2.8" />
      <path d="M12 3v2.2M12 18.8V21M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M3 12h2.2M18.8 12H21M4.9 19.1l1.5-1.5M17.6 6.4l1.5-1.5" />
    </svg>
  ),
};

const NAV: { group: string | null; items: { to: string; label: string; icon: string }[] }[] = [
  {
    group: null,
    items: [
      { to: '/', label: 'Today', icon: 'dashboard' },
      { to: '/pipeline', label: 'Pipeline', icon: 'pipeline' },
      { to: '/leads', label: 'Leads', icon: 'leads' },
      { to: '/reports', label: 'Reports', icon: 'reports' },
    ],
  },
  {
    group: 'Sourcing',
    items: [
      { to: '/scan', label: 'Scan', icon: 'scan' },
      { to: '/sources', label: 'Sources', icon: 'sources' },
    ],
  },
  {
    group: 'Setup',
    items: [
      { to: '/profile', label: 'Profile', icon: 'profile' },
      { to: '/settings', label: 'Settings', icon: 'settings' },
    ],
  },
];

export function Sidebar() {
  return (
    <nav className="sidebar">
      <div className="brand-block">
        <div className="brand-mark">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M13 2 4 14h6l-1 8 9-12h-6z" />
          </svg>
        </div>
        <div>
          <div className="brand">GigPilot</div>
          <div className="brand-sub">freelance ops</div>
        </div>
      </div>
      {NAV.map((section, si) => (
        <div key={si} className="nav-section">
          {section.group && <div className="nav-group-label">{section.group}</div>}
          {section.items.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="nav-item"
              activeProps={{ className: 'nav-item active' }}
              activeOptions={{ exact: n.to === '/' }}
            >
              <span className="nav-icon">{ICONS[n.icon]}</span>
              {n.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
