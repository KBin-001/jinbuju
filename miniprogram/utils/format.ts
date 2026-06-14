export function formatActionMinutes(minutes: number): string {
  const safeMinutes = Math.max(Math.round(Number(minutes) || 0), 0);
  if (safeMinutes < 60) return `${safeMinutes} 分钟`;
  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;
  return remainder > 0 ? `${hours} 小时 ${remainder} 分钟` : `${hours} 小时`;
}
