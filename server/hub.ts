import { snapshotSchema, type Snapshot } from "../shared/usage";
import { run } from "./exec";

const SSH = "/usr/bin/ssh";
const SSH_OPTIONS = [
  "-o", "BatchMode=yes",
  "-o", "ConnectTimeout=10",
  "-o", "ServerAliveInterval=10",
  "-o", "ServerAliveCountMax=3",
];

export function safeMachineName(name: string): string {
  return name.trim().replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "") || "machine";
}

function checkTarget(host: string, dir: string) {
  if (!/^[A-Za-z0-9._@-]+$/.test(host)) throw new Error(`Invalid hub host: ${host}`);
  if (!/^[A-Za-z0-9._/~-]+$/.test(dir) || dir.split("/").includes("..")) {
    throw new Error(`Invalid hub directory: ${dir}`);
  }
}

// Paths are validated above, so single quotes are enough. A leading ~/ is left to the remote shell.
function remotePath(dir: string): string {
  return dir.startsWith("~/") ? `~/'${dir.slice(2)}'` : `'${dir}'`;
}

export async function pushSnapshot(host: string, dir: string, snapshot: Snapshot): Promise<void> {
  checkTarget(host, dir);
  const name = safeMachineName(snapshot.machine);
  const d = remotePath(dir);
  const command = `mkdir -p ${d} && cat > ${d}/'.${name}.json.tmp' && mv ${d}/'.${name}.json.tmp' ${d}/'${name}.json'`;
  await run(SSH, [...SSH_OPTIONS, host, command], { input: JSON.stringify(snapshot), timeoutMs: 60_000 });
}

export async function removeSnapshot(host: string, dir: string, machine: string): Promise<void> {
  checkTarget(host, dir);
  const name = safeMachineName(machine);
  await run(SSH, [...SSH_OPTIONS, host, `rm -f ${remotePath(dir)}/'${name}.json'`], { timeoutMs: 60_000 });
}

export async function pullSnapshots(host: string, dir: string): Promise<Snapshot[]> {
  checkTarget(host, dir);
  const command = `cd ${remotePath(dir)} 2>/dev/null || exit 0; for f in *.json; do [ -f "$f" ] && { cat "$f"; echo; }; done`;
  const { stdout } = await run(SSH, [...SSH_OPTIONS, host, command], { timeoutMs: 60_000 });
  const snapshots: Snapshot[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = snapshotSchema.safeParse(JSON.parse(line));
      if (parsed.success) snapshots.push(parsed.data);
    } catch {
      // Skip a file another machine is writing or a foreign file in the directory.
    }
  }
  return snapshots;
}
