import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useLocation } from '@tanstack/react-router';
import { Sidebar } from './Sidebar';
import { AIConsole } from '../lib/aiConsole';
import './ui.css';

export function AppShell({ children }: { children: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  return (
    <>
      <div className={`app ${navOpen ? 'nav-open' : ''}`}>
        <button
          className="nav-toggle"
          onClick={() => setNavOpen((v) => !v)}
          aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={navOpen}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            {navOpen ? <path d="M6 6 18 18M6 18 18 6" /> : <path d="M4 6h16M4 12h16M4 18h16" />}
          </svg>
        </button>
        {navOpen && <div className="nav-scrim" onClick={() => setNavOpen(false)} />}
        <Sidebar />
        <main className="main">{children}</main>
        <AIConsole />
      </div>
    </>
  );
}
