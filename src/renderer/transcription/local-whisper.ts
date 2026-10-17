import type { Speaker } from "../../shared/types";
import type { AudioFrame } from "../audio/capture";
import { cleanWhisperText, SpeechChunker, type SpeechChunk } from "./chunker";
import type { Transcriber, TranscriberCallbacks } from "./types";
import type { WorkerRequest, WorkerResponse } from "./whisper.worker";

interface Pending {
  speaker: Speaker;
  startMs: number;
  endMs: number;
}

export class LocalWhisperTranscriber implements Transcriber {
  private worker: Worker | null = null;
  private readonly chunkers: Record<Speaker, SpeechChunker> = {
    me: new SpeechChunker(),
    them: new SpeechChunker(),
  };
  private readonly pending = new Map<number, Pending>();
  private nextId = 0;
  private drained: (() => void) | null = null;

  constructor(
    private readonly model: string,
    private readonly callbacks: TranscriberCallbacks,
  ) {}

  async start(): Promise<void> {
    const worker = new Worker("whisper.worker.js", { type: "module" });
    this.worker = worker;
    this.callbacks.onStatus?.("Loading on-device model…");

    await new Promise<void>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const message = event.data;
        if (message.type === "ready") {
          this.callbacks.onStatus?.(`Transcribing on-device (${message.device === "webgpu" ? "GPU" : "CPU"})`);
          worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.handle(e.data);
          resolve();
        } else if (message.type === "progress") {
          this.callbacks.onStatus?.(message.message);
        } else if (message.type === "error") {
          reject(new Error(`Couldn't load the speech model: ${message.message}`));
        }
      };
      worker.onerror = (event) => reject(new Error(`Speech worker crashed: ${event.message}`));
      this.post({ type: "load", model: this.model });
    });
  }

  push(frame: AudioFrame): void {
    this.enqueue("me", this.chunkers.me.push(frame.mic));
    this.enqueue("them", this.chunkers.them.push(frame.system));
  }

  async stop(): Promise<void> {
    this.enqueue("me", this.chunkers.me.flush());
    this.enqueue("them", this.chunkers.them.flush());
    if (this.pending.size > 0) {
      await new Promise<void>((resolve) => {
        this.drained = resolve;
      });
    }
    this.worker?.terminate();
    this.worker = null;
  }

  private enqueue(speaker: Speaker, chunks: SpeechChunk[]): void {
    for (const chunk of chunks) {
      const id = this.nextId++;
      this.pending.set(id, { speaker, startMs: chunk.startMs, endMs: chunk.endMs });
      this.post({ type: "transcribe", id, audio: chunk.audio }, [chunk.audio.buffer]);
    }
  }

  private handle(message: WorkerResponse): void {
    if (message.type === "result" || message.type === "error") {
      const job = message.id !== undefined ? this.pending.get(message.id) : undefined;
      if (message.id !== undefined) this.pending.delete(message.id);

      if (message.type === "error") {
        this.callbacks.onError(new Error(`On-device transcription failed: ${message.message}`));
      } else if (job) {
        const text = cleanWhisperText(message.text);
        if (text) this.callbacks.onSegment({ ...job, text });
      }
      if (this.pending.size === 0 && this.drained) {
        this.drained();
        this.drained = null;
      }
    }
  }

  private post(message: WorkerRequest, transfer: Transferable[] = []): void {
    this.worker?.postMessage(message, transfer);
  }
}
