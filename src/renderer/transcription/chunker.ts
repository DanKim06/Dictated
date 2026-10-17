import { rms } from "../audio/pcm";

export interface SpeechChunk {
  audio: Float32Array;
  startMs: number;
  endMs: number;
}

export interface ChunkerOptions {
  /** RMS level above which a 100 ms frame counts as speech. */
  threshold: number;
  /** Silence that ends an utterance. */
  silenceMs: number;
  /** Force a cut so long monologues still appear promptly. */
  maxMs: number;
  /** Ignore blips shorter than this (coughs, keyboard clicks). */
  minSpeechMs: number;
  frameMs: number;
}

const DEFAULTS: ChunkerOptions = { threshold: 0.008, silenceMs: 700, maxMs: 15000, minSpeechMs: 300, frameMs: 100 };

/**
 * An energy-based voice activity detector. Whisper transcribes fixed clips
 * rather than a live stream, so we cut the audio into utterances at pauses
 * and send each one off as it completes.
 */
export class SpeechChunker {
  private readonly options: ChunkerOptions;
  private frames: Float32Array[] = [];
  private preRoll: Float32Array | null = null;
  private chunkStartMs = 0;
  private speechMs = 0;
  private silenceRunMs = 0;
  private positionMs = 0;

  constructor(options: Partial<ChunkerOptions> = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  push(frame: Float32Array): SpeechChunk[] {
    const { threshold, silenceMs, maxMs, frameMs } = this.options;
    const isSpeech = rms(frame) >= threshold;
    const out: SpeechChunk[] = [];

    if (this.frames.length === 0) {
      if (isSpeech) {
        // Keep one frame of lead-in so the first syllable isn't clipped.
        this.frames = this.preRoll ? [this.preRoll, frame] : [frame];
        this.chunkStartMs = this.positionMs - (this.preRoll ? frameMs : 0);
        this.speechMs = frameMs;
        this.silenceRunMs = 0;
      }
      this.preRoll = frame;
    } else {
      this.frames.push(frame);
      if (isSpeech) {
        this.speechMs += frameMs;
        this.silenceRunMs = 0;
      } else {
        this.silenceRunMs += frameMs;
      }
      const durationMs = this.frames.length * frameMs;
      if (this.silenceRunMs >= silenceMs || durationMs >= maxMs) {
        const chunk = this.cut();
        if (chunk) out.push(chunk);
      }
    }

    this.positionMs += frameMs;
    return out;
  }

  flush(): SpeechChunk[] {
    const chunk = this.cut();
    return chunk ? [chunk] : [];
  }

  private cut(): SpeechChunk | null {
    const frames = this.frames;
    const speechMs = this.speechMs;
    this.frames = [];
    this.speechMs = 0;
    this.silenceRunMs = 0;
    this.preRoll = null;
    if (frames.length === 0 || speechMs < this.options.minSpeechMs) return null;

    const audio = new Float32Array(frames.reduce((n, f) => n + f.length, 0));
    let offset = 0;
    for (const f of frames) {
      audio.set(f, offset);
      offset += f.length;
    }
    return {
      audio,
      startMs: this.chunkStartMs,
      endMs: this.chunkStartMs + frames.length * this.options.frameMs,
    };
  }
}

// Whisper emits these on silence or music; they aren't speech.
const NON_SPEECH = /\[(blank_audio|music|silence|inaudible)[^\]]*\]|\((music|silence|inaudible)[^)]*\)/gi;
// Whole-clip outputs Whisper is known to hallucinate on near-silent audio.
const HALLUCINATIONS = new Set(["you", "thank you.", "thanks for watching!", "bye."]);

export function cleanWhisperText(text: string): string {
  const cleaned = text.replace(NON_SPEECH, "").replace(/\s+/g, " ").trim();
  return HALLUCINATIONS.has(cleaned.toLowerCase()) ? "" : cleaned;
}
