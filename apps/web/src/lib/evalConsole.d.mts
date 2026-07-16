export const EVAL_PHASES: string[];
export function nextPhaseIndex(current: number, total: number): number;
export function resolveReportFile(
  items: Array<{ url: string; report?: string | null } | null | undefined> | null | undefined,
  url: string | null,
): string | null;
