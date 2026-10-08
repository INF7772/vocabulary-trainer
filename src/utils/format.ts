export function formatAccuracy(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '—' : `${Math.round(value)}%`;
}

export function formatDuration(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) return '—';
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}
