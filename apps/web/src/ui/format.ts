export function formatTime(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export function shortHash(hash: string | undefined, keep = 10): string {
  if (!hash) return '—';
  return hash.length > keep + 2 ? `${hash.slice(0, keep)}…` : hash;
}

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
