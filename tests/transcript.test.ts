import { describe, expect, it } from "vitest";
import { dedupeEcho, formatTimestamp, formatTranscript, insertSegment } from "../src/shared/transcript";
import type { TranscriptSegment } from "../src/shared/types";

const seg = (id: string, speaker: "me" | "them", text: string, startMs: number, endMs = startMs + 2000): TranscriptSegment => ({
  id, speaker, text, startMs, endMs,
});

describe("formatTimestamp", () => {
  it("formats minutes and seconds", () => {
    expect(formatTimestamp(0)).toBe("00:00");
    expect(formatTimestamp(83_400)).toBe("01:23");
  });
  it("adds hours for long meetings", () => {
    expect(formatTimestamp(3_723_000)).toBe("1:02:03");
  });
});

describe("formatTranscript", () => {
  it("labels speakers and timestamps", () => {
    expect(formatTranscript([seg("a", "me", "Hi", 0), seg("b", "them", "Hello", 5000)])).toBe(
      "[00:00] Me: Hi\n[00:05] Them: Hello",
    );
  });
});

describe("insertSegment", () => {
  it("keeps segments ordered by start time", () => {
    const list = [seg("a", "me", "one", 0), seg("c", "me", "three", 10_000)];
    const result = insertSegment(list, seg("b", "them", "two", 5000));
    expect(result.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(list).toHaveLength(2); // original untouched
  });
});

describe("dedupeEcho", () => {
  it("drops a mic segment that echoes the system audio at the same time", () => {
    const result = dedupeEcho([
      seg("them", "them", "Let's ship the release on Friday.", 10_000),
      seg("echo", "me", "let's ship the release on friday", 10_300),
    ]);
    expect(result.map((s) => s.id)).toEqual(["them"]);
  });

  it("keeps the user's own speech", () => {
    const result = dedupeEcho([
      seg("them", "them", "Let's ship the release on Friday.", 10_000),
      seg("mine", "me", "Friday works, I'll update the changelog.", 13_000),
    ]);
    expect(result).toHaveLength(2);
  });

  it("keeps similar words said much later", () => {
    const result = dedupeEcho([
      seg("them", "them", "ship it on friday", 0),
      seg("later", "me", "ship it on friday", 60_000),
    ]);
    expect(result).toHaveLength(2);
  });
});
