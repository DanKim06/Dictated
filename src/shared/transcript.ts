import type { Speaker, TranscriptSegment } from "./types";

const SPEAKER_LABEL: Record<Speaker, string> = { me: "Me", them: "Them" };

export function formatTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Plain-text transcript, one line per segment: "[01:23] Them: hello". */
export function formatTranscript(segments: readonly TranscriptSegment[]): string {
  return segments
    .map((s) => `[${formatTimestamp(s.startMs)}] ${SPEAKER_LABEL[s.speaker]}: ${s.text}`)
    .join("\n");
}

/** Inserts a segment keeping the list ordered by start time. Returns a new array. */
export function insertSegment(
  segments: readonly TranscriptSegment[],
  segment: TranscriptSegment,
): TranscriptSegment[] {
  const index = segments.findIndex((s) => s.startMs > segment.startMs);
  if (index === -1) return [...segments, segment];
  return [...segments.slice(0, index), segment, ...segments.slice(index)];
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}' ]+/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length > 0),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

/**
 * Without headphones the microphone also hears the other participants through
 * the speakers, so their words show up twice: once on the system channel
 * ("them") and once, fainter, on the mic channel ("me"). Drop "me" segments
 * that closely match a "them" segment spoken at about the same time.
 */
export function dedupeEcho(
  segments: readonly TranscriptSegment[],
  { windowMs = 2500, threshold = 0.6 } = {},
): TranscriptSegment[] {
  const theirs = segments
    .filter((s) => s.speaker === "them")
    .map((s) => ({ segment: s, tokens: tokens(s.text) }));

  return segments.filter((s) => {
    if (s.speaker !== "me") return true;
    const mine = tokens(s.text);
    return !theirs.some(
      (t) =>
        s.startMs <= t.segment.endMs + windowMs &&
        t.segment.startMs <= s.endMs + windowMs &&
        jaccard(mine, t.tokens) >= threshold,
    );
  });
}
