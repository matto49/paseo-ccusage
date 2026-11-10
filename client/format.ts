export function formatTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

export function formatCost(n: number): string {
  const digits = n >= 100 ? 0 : 2;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function minutesSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.max(0, Math.round((now - t) / 60_000));
}

export function formatAge(minutes: number | null): string {
  if (minutes === null) return "从未";
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} 小时前`;
  return `${Math.round(minutes / 1440)} 天前`;
}

export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

/** Relative change, or percentage points for values that are already ratios. Null when there is nothing to compare. */
export function formatDelta(
  value: number | null,
  previous: number | null,
  points: boolean,
): { text: string; direction: "up" | "down" | "flat" } | null {
  if (value === null || previous === null) return null;
  const diff = points ? (value - previous) * 100 : previous === 0 ? null : ((value - previous) / previous) * 100;
  if (diff === null || !Number.isFinite(diff)) return null;
  const direction = Math.abs(diff) < 0.05 ? "flat" : diff > 0 ? "up" : "down";
  const sign = diff > 0 ? "+" : "";
  return { text: `${sign}${diff.toFixed(1)}${points ? "pt" : "%"}`, direction };
}
