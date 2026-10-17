import type { Speaker, TranscriptSegment } from "../../shared/types";
import type { AudioFrame } from "../audio/capture";

export type NewSegment = Omit<TranscriptSegment, "id">;

export interface TranscriberCallbacks {
  onSegment(segment: NewSegment): void;
  /** Interim text that may still change (cloud provider only). */
  onPartial?(speaker: Speaker, text: string): void;
  onStatus?(message: string): void;
  onError(error: Error): void;
}

/** Both backends implement this, so the UI doesn't care where speech-to-text runs. */
export interface Transcriber {
  start(): Promise<void>;
  push(frame: AudioFrame): void;
  /** Flushes buffered audio and resolves once the last segments are delivered. */
  stop(): Promise<void>;
}

export const CHANNEL_SPEAKERS: readonly Speaker[] = ["me", "them"];
