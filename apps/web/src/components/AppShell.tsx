import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { AIConsole } from '../lib/aiConsole';
import './ui.css';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <Sidebar />
      <main className="main">{children}</main>
      <AIConsole />
    </div>
  );
}
