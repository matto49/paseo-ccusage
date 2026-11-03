import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import {
  snapshotSchema,
  type HubSettings,
  type MachineInfo,
  type Snapshot,
  type Summary,
  type UsageRow,
} from "../shared/usage";
import { runDaily } from "./ccusage";
import { pullSnapshots, pushSnapshot, removeSnapshot, safeMachineName } from "./hub";

// Days re-counted on every incremental run, so late writes near midnight still land.
const RECOUNT_DAYS = 2;
const PULL_MAX_AGE_MS = 60_000;

const dataDir = join(process.env.PASEO_HOME ?? join(homedir(), ".paseo"), "plugin-data", "ccusage-hub");
const localFile = join(dataDir, "local.json");
const hubFile = join(dataDir, "hub.json");
const publishedFile = join(dataDir, "published.json");

function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function todayIn(timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

// `since` = incremental run: dates from `since` on are replaced.
// Full run: dates present in the new result are replaced; older dates whose logs were
// already cleaned up by the agent CLI are kept from the cache.
export function mergeRows(old: UsageRow[], fresh: UsageRow[], since: string | null): UsageRow[] {
  const freshDates = new Set(fresh.map((r) => r.date));
  const kept = old.filter((r) => (since ? r.date < since : !freshDates.has(r.date)));
  return [...kept, ...fresh].sort((a, b) => a.date.localeCompare(b.date));
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function writeJson(file: string, value: unknown) {
  await mkdir(dataDir, { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(value));
  await rename(tmp, file);
}

export class UsageSync {
  private local: Snapshot | null = null;
  private hub: Snapshot[] = [];
  private loaded = false;
  private running: Promise<void> | null = null;
  private pulling: Promise<void> | null = null;
  private lastLocalRunAt: string | null = null;
  private lastPushAt: string | null = null;
  private lastPullAt: string | null = null;
  private localError: string | null = null;
  private hubError: string | null = null;

  constructor(private readonly getSettings: () => Promise<HubSettings>) {}

  machineName(settings: HubSettings): string {
    return safeMachineName(settings.machineName || hostname().replace(/\.local$/, ""));
  }

  private async load() {
    if (this.loaded) return;
    this.loaded = true;
    const local = snapshotSchema.safeParse(await readJson(localFile));
    if (local.success) this.local = local.data;
    const hub = await readJson(hubFile);
    if (Array.isArray(hub)) {
      this.hub = hub.flatMap((s) => {
        const parsed = snapshotSchema.safeParse(s);
        return parsed.success ? [parsed.data] : [];
      });
    }
  }

  get isSyncing(): boolean {
    return this.running !== null;
  }

  sync(): Promise<void> {
    if (!this.running) {
      this.running = this.syncOnce().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async syncOnce() {
    await this.load();
    const settings = await this.getSettings();
    const machine = this.machineName(settings);

    try {
      const previous = this.local?.timezone === settings.timezone ? this.local : null;
      const lastDate = previous?.rows.at(-1)?.date;
      const since = lastDate ? shiftDate(lastDate, -RECOUNT_DAYS) : null;
      const started = Date.now();
      const { rows, version } = await runDaily({
        configuredPath: settings.ccusagePath,
        timezone: settings.timezone,
        since,
      });
      this.local = {
        schema: 1,
        machine,
        generatedAt: new Date().toISOString(),
        timezone: settings.timezone,
        ccusageVersion: version,
        rows: mergeRows(previous?.rows ?? [], rows, since),
      };
      await writeJson(localFile, this.local);
      this.lastLocalRunAt = this.local.generatedAt;
      this.localError = null;
      console.log(
        `[ccusage-hub] counted ${since ? `since ${since}` : "full history"} in ${Math.round((Date.now() - started) / 1000)}s, ${this.local.rows.length} rows`,
      );
    } catch (error) {
      this.localError = (error as Error).message;
      console.error("[ccusage-hub] local count failed:", this.localError);
    }

    if (this.local) {
      // A rename keeps the cached history but publishes it under the new name.
      if (this.local.machine !== machine) this.local = { ...this.local, machine };
      try {
        await pushSnapshot(settings.hubHost, settings.hubDir, this.local);
        // Drop the file published under an old name so the machine is not counted twice.
        const published = await readJson(publishedFile);
        const old = typeof published === "object" && published ? (published as { machine?: unknown }).machine : null;
        if (typeof old === "string" && safeMachineName(old) !== machine) {
          await removeSnapshot(settings.hubHost, settings.hubDir, old);
          console.log(`[ccusage-hub] renamed ${old} -> ${machine} on the hub`);
        }
        await writeJson(publishedFile, { machine, host: settings.hubHost, dir: settings.hubDir });
        this.lastPushAt = new Date().toISOString();
        this.hubError = null;
      } catch (error) {
        this.hubError = `Upload to ${settings.hubHost} failed: ${(error as Error).message}`;
        console.error("[ccusage-hub]", this.hubError);
      }
    }
    await this.pull(settings);
  }

  private pull(settings: HubSettings): Promise<void> {
    if (!this.pulling) {
      this.pulling = (async () => {
        try {
          this.hub = await pullSnapshots(settings.hubHost, settings.hubDir);
          await writeJson(hubFile, this.hub);
          this.lastPullAt = new Date().toISOString();
          if (this.hubError?.startsWith("Download")) this.hubError = null;
        } catch (error) {
          this.hubError = `Download from ${settings.hubHost} failed: ${(error as Error).message}`;
          console.error("[ccusage-hub]", this.hubError);
        }
      })().finally(() => {
        this.pulling = null;
      });
    }
    return this.pulling;
  }

  async summary(): Promise<Summary> {
    await this.load();
    const settings = await this.getSettings();
    const self = this.machineName(settings);
    const pulledAt = this.lastPullAt ? Date.parse(this.lastPullAt) : 0;
    if (!this.running && Date.now() - pulledAt > PULL_MAX_AGE_MS) await this.pull(settings);

    // This machine's own data comes from the local cache, which is never older than the hub copy.
    const byMachine = new Map<string, Snapshot>();
    for (const snapshot of this.hub) byMachine.set(snapshot.machine, snapshot);
    if (this.local) byMachine.set(self, { ...this.local, machine: self });

    const machines: MachineInfo[] = [...byMachine.values()]
      .map((s) => ({
        machine: s.machine,
        isSelf: s.machine === self,
        generatedAt: s.generatedAt,
        timezone: s.timezone,
        ccusageVersion: s.ccusageVersion,
      }))
      .sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || a.machine.localeCompare(b.machine));
    if (!byMachine.has(self)) {
      machines.unshift({ machine: self, isSelf: true, generatedAt: null, timezone: null, ccusageVersion: null });
    }

    return {
      self,
      hubHost: settings.hubHost,
      today: todayIn(settings.timezone),
      timezone: settings.timezone,
      machines,
      rows: [...byMachine.values()].flatMap((s) => s.rows.map((r) => ({ ...r, machine: s.machine }))),
      syncing: this.isSyncing,
      lastLocalRunAt: this.lastLocalRunAt ?? this.local?.generatedAt ?? null,
      lastPushAt: this.lastPushAt,
      lastPullAt: this.lastPullAt,
      localError: this.localError,
      hubError: this.hubError,
    };
  }
}
