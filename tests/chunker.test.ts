import { describe, expect, it } from "vitest";
import { cleanWhisperText, SpeechChunker } from "../src/renderer/transcription/chunker";

const FRAME = 1600; // 100 ms at 16 kHz
const silence = () => new Float32Array(FRAME);
const speech = () => new Float32Array(FRAME).fill(0.1);

function feed(chunker: SpeechChunker, pattern: string) {
  // "s" = 100 ms of speech, "." = 100 ms of silence
  return [...pattern].flatMap((c) => chunker.push(c === "s" ? speech() : silence()));
}

describe("SpeechChunker", () => {
  it("emits an utterance after a pause", () => {
    const chunks = feed(new SpeechChunker(), `..${"s".repeat(10)}${".".repeat(7)}`);
    expect(chunks).toHaveLength(1);
    // Starts one frame early (pre-roll) at 100 ms, covers speech plus the pause.
    expect(chunks[0]?.startMs).toBe(100);
    expect(chunks[0]?.endMs).toBe(100 + 18 * 100);
    expect(chunks[0]?.audio).toHaveLength(18 * FRAME);
  });

  it("ignores short blips", () => {
    expect(feed(new SpeechChunker(), `s${".".repeat(10)}`)).toHaveLength(0);
  });

  it("cuts long monologues at maxMs", () => {
    const chunks = feed(new SpeechChunker({ maxMs: 2000 }), "s".repeat(45));
    expect(chunks).toHaveLength(2);
  });

  it("flushes speech still in progress", () => {
    const chunker = new SpeechChunker();
    feed(chunker, "ssssss");
    expect(chunker.flush()).toHaveLength(1);
    expect(chunker.flush()).toHaveLength(0);
  });
});

describe("cleanWhisperText", () => {
  it("removes non-speech markers", () => {
    expect(cleanWhisperText(" [BLANK_AUDIO] ")).toBe("");
    expect(cleanWhisperText("(music) Okay, let's  start.")).toBe("Okay, let's start.");
  });

  it("drops Whisper's stock silence hallucinations", () => {
    expect(cleanWhisperText(" you")).toBe("");
    expect(cleanWhisperText("Thank you.")).toBe("");
    expect(cleanWhisperText("Thank you for the update.")).toBe("Thank you for the update.");
  });
});
