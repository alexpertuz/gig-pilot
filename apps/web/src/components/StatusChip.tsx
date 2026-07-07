const COLORS: Record<string, string> = {
  new: 'var(--muted)',
  contacted: 'var(--primary)',
  replied: 'var(--accent)',
  negotiating: 'var(--warn)',
  won: 'var(--go)',
  lost: 'var(--danger)',
  dropped: 'var(--muted)',
  evaluated: 'var(--accent)',
  evaluating: 'var(--warn)',
};

export function StatusChip({ status }: { status: string | null }) {
  const s = (status || 'new').toLowerCase();
  const color = COLORS[s] || 'var(--muted)';
  return (
    <span className="chip" style={{ color, borderColor: color }}>
      {s}
    </span>
  );
}
