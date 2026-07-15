import { createFileRoute } from '@tanstack/react-router';
import { PipelineBoard } from '../components/PipelineBoard';

export const Route = createFileRoute('/pipeline')({
  component: () => (
    <div>
      <h1 className="page-title">Pipeline</h1>
      <p className="page-subtitle">
        Every gig found by a scan or added by hand lands here. Gigs are grouped by fit score — work top to bottom.
      </p>
      <PipelineBoard />
    </div>
  ),
});
