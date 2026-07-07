import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
// apps/server/lib -> repo root is three levels up
export const REPO_ROOT = process.env.GIGOPS_ROOT
  ? path.resolve(process.env.GIGOPS_ROOT)
  : path.resolve(here, '..', '..', '..');

export const paths = {
  pipeline: path.join(REPO_ROOT, 'data', 'pipeline.md'),
  profile: path.join(REPO_ROOT, 'config', 'profile.yml'),
  sources: path.join(REPO_ROOT, 'sources.yml'),
  leadsMd: path.join(REPO_ROOT, 'data', 'leads.md'),
  reportsDir: path.join(REPO_ROOT, 'reports'),
  scanHistory: path.join(REPO_ROOT, 'data', 'scan-history.tsv'),
  scores: path.join(REPO_ROOT, 'data', 'scores.json'),
};

export const claudeBin = process.env.GIGOPS_CLAUDE_BIN || 'claude';
