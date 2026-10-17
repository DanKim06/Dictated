import { describe, expect, it, vi } from "vitest";
import { getDeepgramAuth } from "../src/main/deepgram-auth";
import { buildDeepgramUrl, parseDeepgramMessage } from "../src/renderer/transcription/deepgram";

describe("buildDeepgramUrl", () => {
  it("requests 16 kHz stereo with one transcript per channel", () => {
    const url = new URL(buildDeepgramUrl());
    expect(url.host).toBe("api.deepgram.com");
    expect(url.searchParams.get("model")).toBe("nova-3");
    expect(url.searchParams.get("sample_rate")).toBe("16000");
    expect(url.searchParams.get("channels")).toBe("2");
    expect(url.searchParams.get("multichannel")).toBe("true");
  });
});

describe("parseDeepgramMessage", () => {
  const results = (channel: number, transcript: string, isFinal: boolean) =>
    JSON.stringify({
      type: "Results",
      channel_index: [channel, 2],
      is_final: isFinal,
      start: 12.5,
      duration: 1.25,
      channel: { alternatives: [{ transcript, confidence: 0.98 }] },
    });

  it("maps channel 0 to me and channel 1 to them", () => {
    expect(parseDeepgramMessage(results(0, "hello", true))).toEqual({
      speaker: "me", text: "hello", startMs: 12500, endMs: 13750, isFinal: true,
    });
    expect(parseDeepgramMessage(results(1, "hi there", false))?.speaker).toBe("them");
  });

  it("ignores metadata and malformed messages", () => {
    expect(parseDeepgramMessage(JSON.stringify({ type: "Metadata" }))).toBeNull();
    expect(parseDeepgramMessage("not json")).toBeNull();
  });
});

describe("getDeepgramAuth", () => {
  it("returns a short-lived bearer token when the key can mint one", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ access_token: "tmp", expires_in: 60 })));
    await expect(getDeepgramAuth("key", fetchImpl as typeof fetch)).resolves.toEqual({ scheme: "bearer", credential: "tmp" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.deepgram.com/v1/auth/grant",
      expect.objectContaining({ method: "POST", headers: expect.objectContaining({ Authorization: "Token key" }) }),
    );
  });

  it("falls back to the API key when token minting isn't allowed", async () => {
    const fetchImpl = vi.fn(async () => new Response("forbidden", { status: 403 }));
    await expect(getDeepgramAuth("key", fetchImpl as typeof fetch)).resolves.toEqual({ scheme: "token", credential: "key" });
  });

  it("reports a rejected key", async () => {
    const fetchImpl = vi.fn(async () => new Response("unauthorized", { status: 401 }));
    await expect(getDeepgramAuth("bad", fetchImpl as typeof fetch)).rejects.toThrow(/rejected/);
  });
});
