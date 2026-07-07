import { Link } from '@tanstack/react-router';

const NAV = [
  { to: '/', label: 'Dashboard', icon: '◱' },
  { to: '/pipeline', label: 'Pipeline', icon: '▚' },
  { to: '/leads', label: 'Leads', icon: '◎' },
  { to: '/reports', label: 'Reports', icon: '▤' },
  { to: '/scan', label: 'Scan', icon: '⚡' },
  { to: '/sources', label: 'Sources', icon: '⛃' },
  { to: '/profile', label: 'Profile', icon: '◔' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
] as const;

export function Sidebar() {
  return (
    <nav className="sidebar">
      <div className="brand">GigPilot</div>
      {NAV.map((n) => (
        <Link
          key={n.to}
          to={n.to}
          className="nav-item"
          activeProps={{ className: 'nav-item active' }}
          activeOptions={{ exact: n.to === '/' }}
        >
          <span className="nav-icon">{n.icon}</span>
          {n.label}
        </Link>
      ))}
    </nav>
  );
}
