import { createFileRoute } from '@tanstack/react-router';
import { ConfigEditor } from '../components/ConfigEditor';

export const Route = createFileRoute('/profile')({
  component: () => (
    <div>
      <h1 className="page-title">Profile</h1>
      <ConfigEditor name="profile" />
    </div>
  ),
});
