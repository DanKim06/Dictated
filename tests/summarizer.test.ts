import { describe, expect, it } from "vitest";
import { buildSummaryPrompt, summarizeMeeting } from "../src/main/summarizer";
import type { Meeting } from "../src/shared/types";

const base: Meeting = {
  id: "m1",
  title: "Q3 planning",
  app: "Zoom",
  createdAt: "2026-10-01T10:00:00Z",
  endedAt: null,
  notes: "- budget?\n- hiring",
  transcript: [
    { id: "1", speaker: "them", text: "We can hire two engineers.", startMs: 5000, endMs: 7000 },
    { id: "2", speaker: "me", text: "we can hire two engineers", startMs: 5200, endMs: 7200 }, // echo
    { id: "3", speaker: "me", text: "Great, I'll draft the job post.", startMs: 9000, endMs: 11000 },
  ],
  summary: null,
};

describe("buildSummaryPrompt", () => {
  it("includes title, notes and a de-echoed transcript", () => {
    const prompt = buildSummaryPrompt(base);
    expect(prompt).toContain("Meeting title: Q3 planning");
    expect(prompt).toContain("Meeting app: Zoom");
    expect(prompt).toContain("<user_notes>\n- budget?\n- hiring\n</user_notes>");
    expect(prompt).toContain("[00:05] Them: We can hire two engineers.");
    expect(prompt).toContain("[00:09] Me: Great, I'll draft the job post.");
    expect(prompt).not.toContain("Me: we can hire two engineers");
  });

  it("says so when there are no notes", () => {
    expect(buildSummaryPrompt({ ...base, notes: " " })).toContain("(the user took no notes)");
  });
});

describe("summarizeMeeting", () => {
  it("refuses to call the API for an empty meeting", async () => {
    await expect(summarizeMeeting({ ...base, notes: "", transcript: [] }, "key", () => {})).rejects.toThrow(
      /nothing to summarize/,
    );
  });
});
