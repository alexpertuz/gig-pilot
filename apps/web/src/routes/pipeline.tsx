import { createFileRoute } from '@tanstack/react-router';
import { PipelineBoard } from '../components/PipelineBoard';

export const Route = createFileRoute('/pipeline')({
  component: () => (
    <div>
      <h1 className="page-title">Pipeline</h1>
      <PipelineBoard />
    </div>
  ),
});
