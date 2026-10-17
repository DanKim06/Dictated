import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface HelperOutput {
  /** False on macOS < 14, where per-process mic usage isn't available. */
  perProcess: boolean;
  micInUse: boolean;
  processes: { bundleId: string; pid: number }[];
}

export function parseHelperOutput(stdout: string): HelperOutput {
  const parsed = JSON.parse(stdout) as Partial<HelperOutput>;
  return {
    perProcess: parsed.perProcess === true,
    micInUse: parsed.micInUse === true,
    processes: Array.isArray(parsed.processes) ? parsed.processes : [],
  };
}

/** `ps -axo comm=` prints executable paths; keep only the binary names. */
export function parseProcessNames(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => path.basename(line.trim()))
    .filter((name) => name.length > 0);
}

/**
 * Returns identifiers for apps using the microphone. The bundled Swift helper
 * asks Core Audio which processes are running audio input (macOS 14+). On
 * older systems it can only say "the mic is in use", so we fall back to the
 * list of running processes and let the app catalog pick a likely candidate.
 */
export async function getMicUsersMac(helperPath: string): Promise<string[]> {
  const { stdout } = await execFileAsync(helperPath, [], { timeout: 5000 });
  const result = parseHelperOutput(stdout);
  if (result.perProcess) return result.processes.map((p) => p.bundleId);
  if (!result.micInUse) return [];
  const ps = await execFileAsync("ps", ["-axo", "comm="], { maxBuffer: 4 * 1024 * 1024 });
  return parseProcessNames(ps.stdout);
}
