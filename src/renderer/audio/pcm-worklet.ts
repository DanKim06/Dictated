// Runs on the real-time audio thread. Input 0 is the microphone, input 1 is
// system audio. Every 100 ms it posts both channels to the main thread.

declare const sampleRate: number;
declare function registerProcessor(name: string, processor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

class PcmTap extends AudioWorkletProcessor {
  private readonly frameSize = Math.round(sampleRate / 10);
  private mic = new Float32Array(this.frameSize);
  private system = new Float32Array(this.frameSize);
  private filled = 0;

  process(inputs: Float32Array[][]): boolean {
    const mic = inputs[0]?.[0];
    const system = inputs[1]?.[0];
    const length = mic?.length ?? system?.length ?? 0;

    for (let i = 0; i < length; i++) {
      this.mic[this.filled] = mic?.[i] ?? 0;
      this.system[this.filled] = system?.[i] ?? 0;
      this.filled++;
      if (this.filled === this.frameSize) {
        this.port.postMessage({ mic: this.mic, system: this.system }, [this.mic.buffer, this.system.buffer]);
        this.mic = new Float32Array(this.frameSize);
        this.system = new Float32Array(this.frameSize);
        this.filled = 0;
      }
    }
    return true; // keep the processor alive
  }
}

registerProcessor("pcm-tap", PcmTap);
