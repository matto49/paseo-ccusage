import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

// One row = one machine's usage of one model through one agent CLI on one day.
export const usageRowSchema = z.object({
  date: z.string(), // YYYY-MM-DD in the configured timezone
  agent: z.string(), // claude, codex, ...
  model: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheCreationTokens: z.number(),
  cacheReadTokens: z.number(),
  cost: z.number(), // API-equivalent USD, as computed by ccusage
});
export type UsageRow = z.infer<typeof usageRowSchema>;

// What each machine uploads to the hub. Only aggregated results, never raw logs.
export const snapshotSchema = z.object({
  schema: z.literal(1),
  machine: z.string(),
  generatedAt: z.string(),
  timezone: z.string(),
  ccusageVersion: z.string(),
  rows: z.array(usageRowSchema),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

export const machineSchema = z.object({
  machine: z.string(),
  isSelf: z.boolean(),
  generatedAt: z.string().nullable(),
  timezone: z.string().nullable(),
  ccusageVersion: z.string().nullable(),
});
export type MachineInfo = z.infer<typeof machineSchema>;

export const summarySchema = z.object({
  self: z.string(),
  hubHost: z.string(),
  today: z.string(),
  timezone: z.string(),
  machines: z.array(machineSchema),
  // Rows from every machine, each tagged with its machine name.
  rows: z.array(usageRowSchema.extend({ machine: z.string() })),
  syncing: z.boolean(),
  lastLocalRunAt: z.string().nullable(),
  lastPushAt: z.string().nullable(),
  lastPullAt: z.string().nullable(),
  localError: z.string().nullable(),
  hubError: z.string().nullable(),
});
export type Summary = z.infer<typeof summarySchema>;

export const summaryRpc = defineRpc({
  name: "hub.summary",
  input: z.object({}),
  output: summarySchema,
});

// Runs ccusage locally, pushes to the hub, pulls everything, then returns the summary.
export const syncRpc = defineRpc({
  name: "hub.sync",
  input: z.object({}),
  output: summarySchema,
});

export const hubSettings = defineSettings({
  id: "hub",
  scope: "host",
  version: 1,
  schema: z.object({
    // Name shown for this machine and used as the hub file name. Empty = hostname.
    machineName: z.string().default(""),
    // SSH host (an alias from ~/.ssh/config works) that stores every machine's snapshot.
    hubHost: z.string().default("ycy"),
    // Directory on the hub, relative to the SSH user's home.
    hubDir: z.string().default(".ccusage-hub"),
    syncIntervalMinutes: z.number().int().min(5).max(1440).default(30),
    timezone: z.string().default("Asia/Shanghai"),
    // Absolute path to a ccusage executable. Empty = auto-detect.
    ccusagePath: z.string().default(""),
  }),
});
export type HubSettings = z.infer<typeof hubSettings.schema>;
