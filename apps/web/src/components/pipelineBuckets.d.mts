import type { PipelineItem } from '../lib/api';

export interface PipelineBuckets {
  active: PipelineItem[];
  lowFit: PipelineItem[];
  quarantine: PipelineItem[];
  rejected: PipelineItem[];
}

export function partitionPipelineItems(items: PipelineItem[]): PipelineBuckets;
