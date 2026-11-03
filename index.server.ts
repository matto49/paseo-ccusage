import type { PluginServerContext } from "@getpaseo/plugin/server";
import { hubSettings, summaryRpc, syncRpc, type HubSettings } from "./shared/usage";
import { UsageSync } from "./server/sync";

const FIRST_SYNC_DELAY_MS = 5_000;

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(hubSettings);
  const defaults = hubSettings.schema.parse({});

  async function readSettings(): Promise<HubSettings> {
    const state = await settings.read();
    return state.status === "ready" ? state.values : defaults;
  }

  const usage = new UsageSync(readSettings);
  let timer: ReturnType<typeof setInterval> | null = null;
  let intervalMinutes = 0;

  function schedule(minutes: number) {
    if (timer && minutes === intervalMinutes) return;
    if (timer) clearInterval(timer);
    intervalMinutes = minutes;
    timer = setInterval(() => void usage.sync(), minutes * 60_000);
  }

  const first = setTimeout(async () => {
    schedule((await readSettings()).syncIntervalMinutes);
    void usage.sync();
  }, FIRST_SYNC_DELAY_MS);

  const unsubscribe = settings.subscribe((state) => {
    if (state.status !== "ready") return;
    schedule(state.values.syncIntervalMinutes);
    void usage.sync();
  });

  server.handle(summaryRpc, () => usage.summary());
  // A first full count can take minutes, so this starts the sync and returns at once.
  // The client polls hub.summary while `syncing` is true.
  server.handle(syncRpc, () => {
    void usage.sync();
    return usage.summary();
  });

  return () => {
    clearTimeout(first);
    if (timer) clearInterval(timer);
    unsubscribe();
  };
}
