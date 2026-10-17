import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Windows records every app's microphone use under this registry key (it's
// what powers the mic icon in the taskbar). An app whose LastUsedTimeStop is 0
// is using the microphone right now.
const CONSENT_KEY =
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone";

/** Parses `reg query <key> /s` output into the app identifiers currently using the mic. */
export function parseMicConsentStore(output: string): string[] {
  const active: string[] = [];
  let key: string | null = null;
  let start: bigint | null = null;
  let stop: bigint | null = null;

  const flush = () => {
    if (key !== null && start !== null && start > 0n && stop === 0n) {
      // NonPackaged keys are exe paths with "\" written as "#"; packaged apps use their family name.
      const leaf = key.split("\\").pop() ?? "";
      const name = leaf.split("#").pop() ?? leaf;
      if (name) active.push(name.toLowerCase());
    }
    start = null;
    stop = null;
  };

  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("HKEY_")) {
      flush();
      key = line.trim();
      continue;
    }
    const value = /^\s+(LastUsedTimeStart|LastUsedTimeStop)\s+REG_QWORD\s+(0x[0-9a-fA-F]+)/.exec(line);
    if (value) {
      const parsed = BigInt(value[2] ?? "0x0");
      if (value[1] === "LastUsedTimeStart") start = parsed;
      else stop = parsed;
    }
  }
  flush();
  return active;
}

export async function getMicUsersWindows(): Promise<string[]> {
  const { stdout } = await execFileAsync("reg", ["query", CONSENT_KEY, "/s"], {
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  return parseMicConsentStore(stdout);
}
