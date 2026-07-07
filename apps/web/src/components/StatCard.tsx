export function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-value mono" style={{ color: accent || 'var(--text)' }}>
        {value}
      </div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
