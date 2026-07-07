import { createRootRoute, Outlet } from '@tanstack/react-router';
import { AppShell } from '../components/AppShell';
import '../styles/theme.css';

export const Route = createRootRoute({
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
