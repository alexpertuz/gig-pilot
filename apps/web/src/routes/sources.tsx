import { createFileRoute } from '@tanstack/react-router';
import { ConfigEditor } from '../components/ConfigEditor';

export const Route = createFileRoute('/sources')({
  component: () => (
    <div>
      <h1 className="page-title">Sources</h1>
      <ConfigEditor name="sources" />
    </div>
  ),
});
