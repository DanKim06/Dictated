import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SettingsStore, type SecretCodec } from "../src/main/settings";
import { MeetingStore } from "../src/main/storage";
import type { Meeting } from "../src/shared/types";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "dictated-test-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const meeting = (id: string, createdAt: string): Meeting => ({
  id, title: `Meeting ${id}`, app: null, createdAt, endedAt: null, notes: "", transcript: [], summary: null,
});

describe("MeetingStore", () => {
  it("saves, lists newest first, and deletes", () => {
    const store = new MeetingStore(dir);
    store.save(meeting("old", "2026-01-01T00:00:00Z"));
    store.save({ ...meeting("new", "2026-02-01T00:00:00Z"), summary: "done" });

    expect(store.list().map((m) => [m.id, m.hasSummary])).toEqual([["new", true], ["old", false]]);
    expect(store.get("old")?.title).toBe("Meeting old");

    store.delete("old");
    expect(store.get("old")).toBeNull();
  });

  it("rejects ids that could escape the meetings folder", () => {
    const store = new MeetingStore(dir);
    expect(() => store.get("../settings")).toThrow(/Invalid meeting id/);
    expect(() => store.save(meeting("a/b", "2026-01-01T00:00:00Z"))).toThrow(/Invalid meeting id/);
  });
});

describe("SettingsStore", () => {
  // Reversible stand-in for the OS keychain.
  const codec: SecretCodec = {
    encrypt: (s) => `x:${[...s].reverse().join("")}`,
    decrypt: (s) => [...s.slice(2)].reverse().join(""),
  };

  it("encrypts secrets at rest and only exposes whether they exist", () => {
    const store = new SettingsStore(dir, codec);
    const result = store.update({ anthropicKey: "sk-ant-secret", transcriptionProvider: "deepgram" });

    expect(result.hasAnthropicKey).toBe(true);
    expect(result.hasDeepgramKey).toBe(false);
    expect(JSON.stringify(result)).not.toContain("sk-ant-secret");
    expect(fs.readFileSync(path.join(dir, "settings.json"), "utf8")).not.toContain("sk-ant-secret");

    const reloaded = new SettingsStore(dir, codec);
    expect(reloaded.getSecret("anthropicKey")).toBe("sk-ant-secret");
    expect(reloaded.get().transcriptionProvider).toBe("deepgram");
  });

  it("removes a secret when set to null and validates the provider", () => {
    const store = new SettingsStore(dir, codec);
    store.update({ deepgramKey: "dg" });
    expect(store.update({ deepgramKey: null }).hasDeepgramKey).toBe(false);
    expect(() => store.update({ transcriptionProvider: "nope" as never })).toThrow(/Unknown transcription provider/);
  });
});
