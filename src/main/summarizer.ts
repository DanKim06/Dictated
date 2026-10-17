import Anthropic from "@anthropic-ai/sdk";
import { dedupeEcho, formatTranscript } from "../shared/transcript";
import type { Meeting } from "../shared/types";

export const SUMMARY_MODEL = "claude-opus-5-5";

export const SYSTEM_PROMPT = `You write meeting notes for Dictated, a desktop note-taking app.

You receive the user's own rough notes and a machine transcript. "Me" is the user (their microphone); "Them" is everyone else on the call (system audio). The transcript can contain recognition errors; infer the intended words from context, and never invent facts that are not supported by the notes or the transcript.

The user's notes show what they cared about, so keep their structure and emphasis, and enrich it with details from the transcript.

Reply in Markdown with these sections, leaving out any section that would be empty:
## Summary
Two to four sentences on the purpose and outcome of the meeting.
## Key points
## Decisions
## Action items
Use "- [ ] Owner: task (due date if mentioned)". Use "Me" or "Them" when no name was given.
## Open questions`;

export function buildSummaryPrompt(meeting: Meeting): string {
  const transcript = formatTranscript(dedupeEcho(meeting.transcript));
  return [
    `Meeting title: ${meeting.title || "Untitled meeting"}`,
    meeting.app ? `Meeting app: ${meeting.app}` : null,
    "",
    "<user_notes>",
    meeting.notes.trim() || "(the user took no notes)",
    "</user_notes>",
    "",
    "<transcript>",
    transcript || "(no transcript was captured)",
    "</transcript>",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/** Turns SDK errors into messages a user can act on. */
export function describeError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return "Your Anthropic API key was rejected. Check it in Settings.";
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "Anthropic rate limit reached. Wait a minute and try again.";
  }
  if (error instanceof Anthropic.BadRequestError) {
    return `The summary request was invalid: ${error.message}`;
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return "Couldn't reach the Anthropic API. Check your internet connection.";
  }
  if (error instanceof Anthropic.APIError) {
    return `Anthropic API error ${error.status ?? ""}: ${error.message}`.trim();
  }
  return error instanceof Error ? error.message : String(error);
}

export async function summarizeMeeting(
  meeting: Meeting,
  apiKey: string,
  onDelta: (text: string) => void,
): Promise<string> {
  if (meeting.transcript.length === 0 && meeting.notes.trim() === "") {
    throw new Error("There is nothing to summarize yet. Record a meeting or write some notes first.");
  }

  const client = new Anthropic({ apiKey });
  try {
    const stream = client.beta.messages.stream({
      model: SUMMARY_MODEL,
      max_tokens: 64000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      // If a safety classifier declines, the API retries on a fallback model
      // inside the same request instead of returning nothing.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildSummaryPrompt(meeting) }],
    });
    stream.on("text", onDelta);

    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") {
      throw new Error("The model declined to summarize this meeting.");
    }
    return message.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("")
      .trim();
  } catch (error) {
    throw new Error(describeError(error));
  }
}
