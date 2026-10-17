// Pure PCM helpers, shared by both transcription backends.

export const TARGET_RATE = 16000;

/**
 * Downsamples by averaging each output sample's source window (a cheap
 * low-pass that avoids the worst aliasing). Speech models only need 16 kHz.
 */
export function downsample(input: Float32Array, fromRate: number, toRate = TARGET_RATE): Float32Array {
  if (fromRate === toRate) return input;
  if (fromRate < toRate) throw new Error(`Cannot upsample from ${fromRate} Hz to ${toRate} Hz`);
  const ratio = fromRate / toRate;
  const output = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < output.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j] ?? 0;
    output[i] = end > start ? sum / (end - start) : 0;
  }
  return output;
}

function toInt16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
}

/** Interleaves two mono channels into 16-bit stereo (channel 0 = mic, 1 = system). */
export function interleaveInt16(left: Float32Array, right: Float32Array): Int16Array<ArrayBuffer> {
  const frames = Math.min(left.length, right.length);
  const out = new Int16Array(frames * 2);
  for (let i = 0; i < frames; i++) {
    out[i * 2] = toInt16(left[i] ?? 0);
    out[i * 2 + 1] = toInt16(right[i] ?? 0);
  }
  return out;
}

export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.sqrt(sum / samples.length);
}
