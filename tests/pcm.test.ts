import { describe, expect, it } from "vitest";
import { downsample, interleaveInt16, rms } from "../src/renderer/audio/pcm";

describe("downsample", () => {
  it("turns 100 ms at 48 kHz into 100 ms at 16 kHz", () => {
    expect(downsample(new Float32Array(4800), 48000)).toHaveLength(1600);
  });

  it("turns 100 ms at 44.1 kHz into 100 ms at 16 kHz", () => {
    expect(downsample(new Float32Array(4410), 44100)).toHaveLength(1600);
  });

  it("averages each window", () => {
    const out = downsample(Float32Array.from([0, 0.3, 0.6, 1, 1, 1]), 48000);
    expect(out[0]).toBeCloseTo(0.3);
    expect(out[1]).toBeCloseTo(1);
  });

  it("passes 16 kHz audio through untouched", () => {
    const input = new Float32Array(10);
    expect(downsample(input, 16000)).toBe(input);
  });
});

describe("interleaveInt16", () => {
  it("interleaves mic and system channels and clamps", () => {
    const out = interleaveInt16(Float32Array.from([1, -1, 2]), Float32Array.from([0, 0.5, -2]));
    expect(Array.from(out)).toEqual([32767, 0, -32768, 16384, 32767, -32768]);
  });
});

describe("rms", () => {
  it("measures signal level", () => {
    expect(rms(new Float32Array(100))).toBe(0);
    expect(rms(Float32Array.from([0.5, -0.5]))).toBeCloseTo(0.5);
  });
});
