import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { UsageRow } from "../shared/usage";
import { run } from "./exec";

interface Runner {
  command: string;
  prefix: string[];
  version: string;
}

let cached: { key: string; runner: Runner } | null = null;

function nativePackage(): string {
  return `ccusage-${process.platform}-${process.arch}`;
}

function candidates(configured: string): Array<{ command: string; prefix: string[] }> {
  const home = homedir();
  const pkg = nativePackage();
  const list: Array<{ command: string; prefix: string[] }> = [];
  if (configured) list.push({ command: configured, prefix: [] });
  // The npm package is only a node launcher for this native binary; calling it directly
  // works without node and skips the launcher.
  for (const root of [
    join(home, ".bun", "install", "global", "node_modules"),
    "/opt/homebrew/lib/node_modules",
    "/usr/local/lib/node_modules",
    join(home, ".npm-global", "lib", "node_modules"),
  ]) {
    list.push({ command: join(root, "@ccusage", pkg, "bin", "ccusage"), prefix: [] });
    list.push({ command: join(root, "ccusage", "node_modules", "@ccusage", pkg, "bin", "ccusage"), prefix: [] });
  }
  for (const bin of ["/opt/homebrew/bin/ccusage", "/usr/local/bin/ccusage", join(home, ".bun", "bin", "ccusage")]) {
    list.push({ command: bin, prefix: [] });
  }
  for (const bun of [join(home, ".bun", "bin", "bun"), "/opt/homebrew/bin/bun", "/usr/local/bin/bun"]) {
    list.push({ command: bun, prefix: ["x", "ccusage@latest"] });
  }
  for (const npx of ["/opt/homebrew/bin/npx", "/usr/local/bin/npx"]) {
    list.push({ command: npx, prefix: ["-y", "ccusage@latest"] });
  }
  return list.filter((c) => existsSync(c.command));
}

async function resolveRunner(configured: string): Promise<Runner> {
  if (cached && cached.key === configured) return cached.runner;
  const tried: string[] = [];
  for (const candidate of candidates(configured)) {
    try {
      const { stdout } = await run(candidate.command, [...candidate.prefix, "--version"], { timeoutMs: 120_000 });
      const version = stdout.trim().split("\n").pop() ?? "unknown";
      const runner = { ...candidate, version };
      cached = { key: configured, runner };
      console.log(`[ccusage-hub] using ${[candidate.command, ...candidate.prefix].join(" ")} (${version})`);
      return runner;
    } catch (error) {
      tried.push(`${candidate.command}: ${(error as Error).message}`);
    }
  }
  throw new Error(
    tried.length
      ? `No working ccusage found. Tried: ${tried.join("; ")}`
      : "ccusage not found. Install it with `bun add -g ccusage` or `npm i -g ccusage`, or set its path in settings.",
  );
}

// ccusage `daily --json --by-agent` output, only the fields we read.
interface ModelBreakdown {
  modelName?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  cost?: number;
}
interface AgentEntry extends ModelBreakdown {
  agent?: string;
  totalCost?: number;
  modelBreakdowns?: ModelBreakdown[];
}
interface DailyEntry extends AgentEntry {
  period?: string;
  date?: string;
  agents?: AgentEntry[];
}

function toRow(date: string, agent: string, m: ModelBreakdown, fallbackCost?: number): UsageRow {
  return {
    date,
    agent,
    model: m.modelName ?? "unknown",
    inputTokens: m.inputTokens ?? 0,
    outputTokens: m.outputTokens ?? 0,
    cacheCreationTokens: m.cacheCreationTokens ?? 0,
    cacheReadTokens: m.cacheReadTokens ?? 0,
    cost: m.cost ?? fallbackCost ?? 0,
  };
}

export function normalize(report: { daily?: DailyEntry[] }): UsageRow[] {
  const rows: UsageRow[] = [];
  for (const day of report.daily ?? []) {
    const date = day.period ?? day.date;
    if (!date) continue;
    const agents = day.agents?.length ? day.agents : [{ ...day, agent: "all" }];
    for (const agent of agents) {
      const name = agent.agent ?? "all";
      if (agent.modelBreakdowns?.length) {
        for (const m of agent.modelBreakdowns) rows.push(toRow(date, name, m));
      } else {
        rows.push(toRow(date, name, agent, agent.totalCost));
      }
    }
  }
  return rows;
}

export async function runDaily(options: {
  configuredPath: string;
  timezone: string;
  since: string | null; // YYYY-MM-DD
}): Promise<{ rows: UsageRow[]; version: string }> {
  const runner = await resolveRunner(options.configuredPath);
  const args = [...runner.prefix, "daily", "--json", "--by-agent", "-z", options.timezone];
  if (options.since) args.push("--since", options.since.replaceAll("-", ""));
  const { stdout } = await run(runner.command, args, { timeoutMs: 15 * 60_000 });
  const start = stdout.indexOf("{");
  if (start < 0) throw new Error("ccusage printed no JSON");
  return { rows: normalize(JSON.parse(stdout.slice(start))), version: runner.version };
}
