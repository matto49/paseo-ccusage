import type { Summary } from "../shared/usage";
import { shiftDate } from "./format";

export type Range = "today" | "7d" | "30d" | "all";
export const RANGES: Array<{ id: Range; label: string; days: number | null }> = [
  { id: "today", label: "今天", days: 1 },
  { id: "7d", label: "7 天", days: 7 },
  { id: "30d", label: "30 天", days: 30 },
  { id: "all", label: "全部", days: null },
];

type SummaryRow = Summary["rows"][number];

export interface Totals {
  cost: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export const emptyTotals = (): Totals => ({
  cost: 0,
  tokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
});

export function rowTokens(r: SummaryRow): number {
  return r.inputTokens + r.outputTokens + r.cacheCreationTokens + r.cacheReadTokens;
}

function add(t: Totals, r: SummaryRow): void {
  t.cost += r.cost;
  t.tokens += rowTokens(r);
  t.inputTokens += r.inputTokens;
  t.outputTokens += r.outputTokens;
  t.cacheCreationTokens += r.cacheCreationTokens;
  t.cacheReadTokens += r.cacheReadTokens;
}

/** Share of prompt tokens served from cache. Null when nothing was sent. */
export function cacheHitRate(t: Totals): number | null {
  const prompt = t.inputTokens + t.cacheCreationTokens + t.cacheReadTokens;
  return prompt > 0 ? t.cacheReadTokens / prompt : null;
}

export interface Kpi {
  id: string;
  label: string;
  value: number | null;
  previous: number | null;
  format: "cost" | "tokens" | "percent" | "count";
}

export interface Bucket {
  /** First date of the bucket, YYYY-MM-DD. */
  start: string;
  /** Last date of the bucket, YYYY-MM-DD. */
  end: string;
  label: string;
  total: Totals;
  machines: Map<string, Totals>;
}

export interface ModelEntry extends Totals {
  agent: string;
  model: string;
}

export interface HeatCell {
  date: string;
  tokens: number;
  cost: number;
  /** 0 = no usage, 1..4 = increasing magnitude. */
  level: 0 | 1 | 2 | 3 | 4;
  future: boolean;
}

export interface UsageView {
  total: Totals;
  byMachine: Map<string, Totals>;
  days: Array<[string, { total: Totals; machines: Map<string, Totals> }]>;
  models: ModelEntry[];
  kpis: Kpi[];
  buckets: Bucket[];
  weekly: boolean;
}

function totalsBetween(rows: SummaryRow[], start: string, end: string): Totals {
  const t = emptyTotals();
  for (const r of rows) if (r.date >= start && r.date <= end) add(t, r);
  return t;
}

function activeDays(rows: SummaryRow[], start: string, end: string): number {
  const dates = new Set<string>();
  for (const r of rows) if (r.date >= start && r.date <= end && rowTokens(r) > 0) dates.add(r.date);
  return dates.size;
}

function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

/** Day of week for a YYYY-MM-DD date: 0 = Sunday. */
export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function shortDate(date: string): string {
  return `${date.slice(5, 7)}/${date.slice(8, 10)}`;
}

export function aggregate(summary: Summary, range: Range): UsageView {
  const days = RANGES.find((r) => r.id === range)?.days ?? null;
  const end = summary.today;
  const earliest = summary.rows.reduce((min, r) => (r.date < min ? r.date : min), end);
  const start = days ? shiftDate(end, -(days - 1)) : earliest;
  const rows = summary.rows.filter((r) => r.date >= start && r.date <= end);

  const byMachine = new Map<string, Totals>();
  const byDay = new Map<string, { total: Totals; machines: Map<string, Totals> }>();
  const byModel = new Map<string, ModelEntry>();
  const total = emptyTotals();

  for (const r of rows) {
    add(total, r);

    const m = byMachine.get(r.machine) ?? emptyTotals();
    add(m, r);
    byMachine.set(r.machine, m);

    const day = byDay.get(r.date) ?? { total: emptyTotals(), machines: new Map<string, Totals>() };
    add(day.total, r);
    const dm = day.machines.get(r.machine) ?? emptyTotals();
    add(dm, r);
    day.machines.set(r.machine, dm);
    byDay.set(r.date, day);

    const key = `${r.agent}\u0000${r.model}`;
    const model = byModel.get(key) ?? { agent: r.agent, model: r.model, ...emptyTotals() };
    add(model, r);
    byModel.set(key, model);
  }

  // The previous period has the same length and ends the day before this one starts.
  const span = daysBetween(start, end);
  const prevEnd = shiftDate(start, -1);
  const prevStart = shiftDate(start, -span);
  const hasPrevious = days !== null;
  const previous = hasPrevious ? totalsBetween(summary.rows, prevStart, prevEnd) : null;
  const active = activeDays(summary.rows, start, end);
  const prevActive = hasPrevious ? activeDays(summary.rows, prevStart, prevEnd) : null;

  const kpis: Kpi[] = [
    { id: "cost", label: "预估费用", value: total.cost, previous: previous?.cost ?? null, format: "cost" },
    { id: "tokens", label: "总 Token", value: total.tokens, previous: previous?.tokens ?? null, format: "tokens" },
    {
      id: "daily",
      label: "日均费用",
      value: active > 0 ? total.cost / active : 0,
      previous: previous && prevActive ? previous.cost / prevActive : null,
      format: "cost",
    },
    { id: "output", label: "输出 Token", value: total.outputTokens, previous: previous?.outputTokens ?? null, format: "tokens" },
    {
      id: "cache",
      label: "缓存命中率",
      value: cacheHitRate(total),
      previous: previous ? cacheHitRate(previous) : null,
      format: "percent",
    },
    { id: "active", label: "活跃天数", value: active, previous: prevActive, format: "count" },
  ];

  // Trend buckets: one per day, or one per week (Monday start) once the span is long.
  const weekly = span > 62;
  const buckets: Bucket[] = [];
  const trendStart = range === "today" ? shiftDate(end, -6) : start;
  let cursor = weekly ? shiftDate(trendStart, -((weekday(trendStart) + 6) % 7)) : trendStart;
  while (cursor <= end) {
    const bucketEnd = weekly ? shiftDate(cursor, 6) : cursor;
    const bucket: Bucket = {
      start: cursor,
      end: bucketEnd > end ? end : bucketEnd,
      label: shortDate(cursor),
      total: emptyTotals(),
      machines: new Map(),
    };
    for (const r of summary.rows) {
      if (r.date < cursor || r.date > bucket.end) continue;
      add(bucket.total, r);
      const bm = bucket.machines.get(r.machine) ?? emptyTotals();
      add(bm, r);
      bucket.machines.set(r.machine, bm);
    }
    buckets.push(bucket);
    cursor = shiftDate(bucketEnd, 1);
  }

  return {
    total,
    byMachine,
    days: [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0])),
    models: [...byModel.values()].sort((a, b) => b.cost - a.cost || b.tokens - a.tokens),
    kpis,
    buckets,
    weekly,
  };
}

const HEAT_THRESHOLDS = [10e6, 100e6, 1e9];
export const HEAT_LEGEND = ["0", "<10M", "<100M", "<1B", "≥1B"];

function heatLevel(tokens: number): HeatCell["level"] {
  if (tokens <= 0) return 0;
  if (tokens < HEAT_THRESHOLDS[0]) return 1;
  if (tokens < HEAT_THRESHOLDS[1]) return 2;
  if (tokens < HEAT_THRESHOLDS[2]) return 3;
  return 4;
}

/** Columns of 7 days (Sunday first), the last column holding today. Ignores the range filter. */
export function heatmap(summary: Summary, weeks: number) {
  const perDay = new Map<string, { tokens: number; cost: number }>();
  for (const r of summary.rows) {
    const d = perDay.get(r.date) ?? { tokens: 0, cost: 0 };
    d.tokens += rowTokens(r);
    d.cost += r.cost;
    perDay.set(r.date, d);
  }
  const lastSunday = shiftDate(summary.today, -weekday(summary.today));
  const first = shiftDate(lastSunday, -7 * (weeks - 1));
  const columns: HeatCell[][] = [];
  let activeCount = 0;
  let tokenSum = 0;
  for (let w = 0; w < weeks; w++) {
    const column: HeatCell[] = [];
    for (let d = 0; d < 7; d++) {
      const date = shiftDate(first, w * 7 + d);
      const usage = perDay.get(date) ?? { tokens: 0, cost: 0 };
      const future = date > summary.today;
      if (!future && usage.tokens > 0) {
        activeCount += 1;
        tokenSum += usage.tokens;
      }
      column.push({ date, tokens: usage.tokens, cost: usage.cost, level: future ? 0 : heatLevel(usage.tokens), future });
    }
    columns.push(column);
  }
  return { columns, activeCount, tokenSum };
}
