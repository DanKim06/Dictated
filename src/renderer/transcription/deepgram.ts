import type { Speaker } from "../../shared/types";
import type { AudioFrame } from "../audio/capture";
import { interleaveInt16, TARGET_RATE } from "../audio/pcm";
import { CHANNEL_SPEAKERS, type Transcriber, type TranscriberCallbacks } from "./types";

export function buildDeepgramUrl(): string {
  const params = new URLSearchParams({
    model: "nova-3",
    encoding: "linear16",
    sample_rate: String(TARGET_RATE),
    channels: "2",
    multichannel: "true", // transcribe mic and system audio independently
    interim_results: "true",
    smart_format: "true",
    punctuate: "true",
    endpointing: "300",
  });
  return `wss://api.deepgram.com/v1/listen?${params}`;
}

export interface ParsedResult {
  speaker: Speaker;
  text: string;
  startMs: number;
  endMs: number;
  isFinal: boolean;
}

/** Turns a Deepgram streaming message into a transcript result, or null if it carries no speech. */
export function parseDeepgramMessage(raw: string): ParsedResult | null {
  let message: {
    type?: string;
    channel_index?: number[];
    is_final?: boolean;
    start?: number;
    duration?: number;
    channel?: { alternatives?: { transcript?: string }[] };
  };
  try {
    message = JSON.parse(raw);
  } catch {
    return null;
  }
  if (message.type !== "Results") return null;
  const text = message.channel?.alternatives?.[0]?.transcript?.trim() ?? "";
  const speaker = CHANNEL_SPEAKERS[message.channel_index?.[0] ?? 0];
  if (!speaker) return null;
  const start = message.start ?? 0;
  return {
    speaker,
    text,
    startMs: Math.round(start * 1000),
    endMs: Math.round((start + (message.duration ?? 0)) * 1000),
    isFinal: message.is_final === true,
  };
}

export class DeepgramTranscriber implements Transcriber {
  private socket: WebSocket | null = null;
  private keepAlive: number | null = null;

  constructor(private readonly callbacks: TranscriberCallbacks) {}

  async start(): Promise<void> {
    const auth = await window.dictated.getDeepgramAuth();
    // Browsers can't set headers on WebSockets; Deepgram accepts the
    // credential as a subprotocol instead.
    const socket = new WebSocket(buildDeepgramUrl(), [auth.scheme, auth.credential]);
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error("Couldn't connect to Deepgram. Check your API key and connection."));
    });

    socket.onmessage = (event: MessageEvent<string>) => {
      const result = parseDeepgramMessage(event.data);
      if (!result) return;
      if (!result.isFinal) {
        this.callbacks.onPartial?.(result.speaker, result.text);
      } else if (result.text) {
        this.callbacks.onPartial?.(result.speaker, "");
        this.callbacks.onSegment({ speaker: result.speaker, text: result.text, startMs: result.startMs, endMs: result.endMs });
      }
    };
    socket.onerror = () => this.callbacks.onError(new Error("Lost connection to Deepgram."));
    socket.onclose = (event) => {
      if (event.code !== 1000 && this.socket) {
        this.callbacks.onError(new Error(`Deepgram closed the connection (${event.code} ${event.reason}).`));
      }
    };
    // Deepgram closes idle streams after ~10 s, e.g. while everyone is muted.
    this.keepAlive = window.setInterval(() => this.sendJson({ type: "KeepAlive" }), 8000);
    this.callbacks.onStatus?.("Transcribing with Deepgram");
  }

  push(frame: AudioFrame): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(interleaveInt16(frame.mic, frame.system).buffer);
    }
  }

  async stop(): Promise<void> {
    if (this.keepAlive !== null) window.clearInterval(this.keepAlive);
    const socket = this.socket;
    if (!socket) return;
    if (socket.readyState === WebSocket.OPEN) {
      // Ask Deepgram to flush final results, then wait (briefly) for it to close.
      this.sendJson({ type: "CloseStream" });
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, 4000);
        socket.addEventListener("close", () => {
          window.clearTimeout(timer);
          resolve();
        });
      });
    }
    this.socket = null;
    socket.close(1000);
  }

  private sendJson(message: object): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }
}
