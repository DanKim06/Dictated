import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_SETTINGS,
  type PublicSettings,
  type Settings,
  type SettingsUpdate,
} from "../shared/types";

export type SecretName = "deepgramKey" | "anthropicKey";

/** Encrypts secrets at rest. In the app this wraps Electron's safeStorage (OS keychain). */
export interface SecretCodec {
  encrypt(plain: string): string;
  decrypt(encoded: string): string;
}

interface StoredSettings extends Settings {
  secrets: Partial<Record<SecretName, string>>;
}

const PROVIDERS = new Set(["local", "deepgram"]);
const SUMMARY_PROVIDERS = new Set(["local", "claude"]);
// Ollama model tags look like "llama3.2", "qwen3:4b" or "library/model:tag".
const OLLAMA_MODEL = /^[A-Za-z0-9._/-]{1,100}(:[A-Za-z0-9._-]{1,50})?$/;

export class SettingsStore {
  private readonly file: string;
  private data: StoredSettings;

  constructor(
    dir: string,
    private readonly codec: SecretCodec,
  ) {
    this.file = path.join(dir, "settings.json");
    this.data = this.load();
  }

  get(): Settings {
    const { secrets: _secrets, ...settings } = this.data;
    return settings;
  }

  getPublic(): PublicSettings {
    return {
      ...this.get(),
      hasDeepgramKey: Boolean(this.data.secrets.deepgramKey),
      hasAnthropicKey: Boolean(this.data.secrets.anthropicKey),
    };
  }

  getSecret(name: SecretName): string | null {
    const encoded = this.data.secrets[name];
    if (!encoded) return null;
    try {
      return this.codec.decrypt(encoded);
    } catch {
      return null; // keychain changed or file copied from another machine
    }
  }

  update(update: SettingsUpdate): PublicSettings {
    const { deepgramKey, anthropicKey, ...rest } = update;
    const next: StoredSettings = { ...this.data, secrets: { ...this.data.secrets } };

    if (rest.transcriptionProvider !== undefined) {
      if (!PROVIDERS.has(rest.transcriptionProvider)) {
        throw new Error(`Unknown transcription provider: ${rest.transcriptionProvider}`);
      }
      next.transcriptionProvider = rest.transcriptionProvider;
    }
    if (typeof rest.whisperModel === "string" && rest.whisperModel.trim()) {
      next.whisperModel = rest.whisperModel.trim();
    }
    if (rest.summaryProvider !== undefined) {
      if (!SUMMARY_PROVIDERS.has(rest.summaryProvider)) {
        throw new Error(`Unknown summary provider: ${rest.summaryProvider}`);
      }
      next.summaryProvider = rest.summaryProvider;
    }
    if (typeof rest.ollamaModel === "string" && OLLAMA_MODEL.test(rest.ollamaModel.trim())) {
      next.ollamaModel = rest.ollamaModel.trim();
    }
    if (typeof rest.autoDetectMeetings === "boolean") next.autoDetectMeetings = rest.autoDetectMeetings;
    if (typeof rest.autoSummarize === "boolean") next.autoSummarize = rest.autoSummarize;

    for (const [name, value] of [
      ["deepgramKey", deepgramKey],
      ["anthropicKey", anthropicKey],
    ] as const) {
      if (value === null || value === "") delete next.secrets[name];
      else if (typeof value === "string") next.secrets[name] = this.codec.encrypt(value.trim());
    }

    this.data = next;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(next, null, 2), { mode: 0o600 });
    return this.getPublic();
  }

  private load(): StoredSettings {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8")) as Partial<StoredSettings>;
      return { ...DEFAULT_SETTINGS, ...parsed, secrets: { ...parsed.secrets } };
    } catch {
      return { ...DEFAULT_SETTINGS, secrets: {} };
    }
  }
}
