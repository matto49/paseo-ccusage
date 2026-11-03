import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

// The daemon is started by the desktop app, so its PATH may miss Homebrew, bun and npm globals.
const EXTRA_PATH = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  join(homedir(), ".bun", "bin"),
  join(homedir(), ".local", "bin"),
  "/usr/bin",
  "/bin",
];

export function childEnv(): NodeJS.ProcessEnv {
  const current = (process.env.PATH ?? "").split(":").filter(Boolean);
  const path = [...current, ...EXTRA_PATH.filter((p) => !current.includes(p))].join(":");
  return { ...process.env, PATH: path, NO_COLOR: "1" };
}

export interface RunOptions {
  input?: string;
  timeoutMs: number;
}

export interface RunResult {
  stdout: string;
  stderr: string;
}

export function run(command: string, args: string[], options: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: childEnv(), stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`${command} timed out after ${Math.round(options.timeoutMs / 1000)}s`));
    }, options.timeoutMs);

    function finish(error: Error | null, result?: RunResult) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result!);
    }

    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      const stdout = Buffer.concat(out).toString("utf8");
      const stderr = Buffer.concat(err).toString("utf8");
      if (code === 0) finish(null, { stdout, stderr });
      else {
        const detail = (stderr || stdout).trim().split("\n").slice(-3).join(" ").slice(0, 400);
        finish(new Error(`${command} exited with ${code}${detail ? `: ${detail}` : ""}`));
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(options.input ?? "");
  });
}
