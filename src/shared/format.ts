export function fmt(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.ceil(min % 60);
  if (h > 0 && m === 0) return `${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
