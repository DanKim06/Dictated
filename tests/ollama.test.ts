import { describe, expect, it } from "vitest";
import { contextWindowFor, getOllamaStatus, stripThinking, summarizeWithOllama } from "../src/main/ollama";
import type { Meeting } from "../src/shared/types";

const meeting: Meeting = {
  id: "m1",
  title: "Standup",
  app: null,
  createdAt: "2026-10-01T10:00:00Z",
  endedAt: null,
  notes: "",
  transcript: [{ id: "1", speaker: "them", text: "Ship it Friday.", startMs: 0, endMs: 1000 }],
  summary: null,
};

/** A streaming response whose body arrives in the given byte chunks. */
function streamResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((c) => controller.enqueue(encoder.encode(c)));
      controller.close();
    },
  });
  return new Response(body, { status });
}

const line = (content: string, done = false) => JSON.stringify({ message: { content }, done }) + "\n";

describe("summarizeWithOllama", () => {
  it("streams NDJSON deltas, even when a line is split across chunks", async () => {
    const full = line("## Summary\n") + line("Ship it Friday.") + line("", true);
    const cut = full.indexOf("Ship") + 2; // split mid-JSON
    let request: RequestInit | undefined;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      request = init;
      return streamResponse([full.slice(0, cut), full.slice(cut)]);
    }) as typeof fetch;

    const deltas: string[] = [];
    const summary = await summarizeWithOllama(meeting, "llama3.2", (d) => deltas.push(d), fetchImpl);

    expect(summary).toBe("## Summary\nShip it Friday.");
    expect(deltas).toEqual(["## Summary\n", "Ship it Friday."]);
    const body = JSON.parse(String(request?.body)) as { model: string; options: { num_ctx: number } };
    expect(body.model).toBe("llama3.2");
    expect(body.options.num_ctx).toBeGreaterThanOrEqual(8192);
  });

  it("explains how to install a missing model", async () => {
    const fetchImpl = (async () => new Response('{"error":"model not found"}', { status: 404 })) as typeof fetch;
    await expect(summarizeWithOllama(meeting, "qwen3:4b", () => {}, fetchImpl)).rejects.toThrow(
      "ollama pull qwen3:4b",
    );
  });

  it("explains how to start Ollama when it isn't running", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(summarizeWithOllama(meeting, "llama3.2", () => {}, fetchImpl)).rejects.toThrow(/isn't running/);
  });

  it("surfaces errors reported mid-stream", async () => {
    const fetchImpl = (async () => streamResponse([JSON.stringify({ error: "out of memory" }) + "\n"])) as typeof fetch;
    await expect(summarizeWithOllama(meeting, "llama3.2", () => {}, fetchImpl)).rejects.toThrow(/out of memory/);
  });
});

describe("getOllamaStatus", () => {
  it("lists installed models", async () => {
    const fetchImpl = (async () =>
      Response.json({ models: [{ name: "qwen3:4b" }, { name: "llama3.2:latest" }] })) as typeof fetch;
    expect(await getOllamaStatus(fetchImpl)).toEqual({ running: true, models: ["llama3.2:latest", "qwen3:4b"] });
  });

  it("reports not running when the server is down", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("ECONNREFUSED");
    }) as typeof fetch;
    expect(await getOllamaStatus(fetchImpl)).toEqual({ running: false, models: [] });
  });
});

describe("helpers", () => {
  it("sizes the context window to the transcript, within limits", () => {
    expect(contextWindowFor("short")).toBe(8192);
    expect(contextWindowFor("x".repeat(70_000))).toBe(22528);
    expect(contextWindowFor("x".repeat(1_000_000))).toBe(32768);
  });

  it("removes inline reasoning", () => {
    expect(stripThinking("<think>hmm\nok</think>\n## Summary")).toBe("## Summary");
  });
});
