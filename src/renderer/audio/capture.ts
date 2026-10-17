import { downsample, rms } from "./pcm";

export interface AudioFrame {
  /** 100 ms of 16 kHz mono audio per channel. */
  mic: Float32Array;
  system: Float32Array;
}

export interface CaptureSession {
  /** False when system audio was unavailable and only the mic is recorded. */
  systemAudio: boolean;
  stop(): void;
}

export interface CaptureCallbacks {
  onFrame(frame: AudioFrame): void;
  onLevels?(levels: { mic: number; system: number }): void;
}

/**
 * Records the microphone and the computer's audio output as two separate
 * channels. Keeping them apart is what lets us label speech "Me" vs "Them"
 * without a meeting bot or speaker diarization.
 */
export async function startCapture(callbacks: CaptureCallbacks): Promise<CaptureSession> {
  const micStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });

  // The main process answers this with loopback (system output) audio.
  let systemStream: MediaStream | null = null;
  try {
    const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    display.getVideoTracks().forEach((track) => track.stop());
    if (display.getAudioTracks().length > 0) {
      systemStream = new MediaStream(display.getAudioTracks());
    }
  } catch (error) {
    console.warn("System audio unavailable, recording microphone only:", error);
  }

  const context = new AudioContext();
  await context.audioWorklet.addModule("pcm-worklet.js");
  const tap = new AudioWorkletNode(context, "pcm-tap", {
    numberOfInputs: 2,
    numberOfOutputs: 1,
    channelCount: 1,
    channelCountMode: "explicit", // downmix stereo sources to mono
  });

  context.createMediaStreamSource(micStream).connect(tap, 0, 0);
  if (systemStream) context.createMediaStreamSource(systemStream).connect(tap, 0, 1);

  // The tap must be connected to the destination to be pulled; mute its output.
  const mute = context.createGain();
  mute.gain.value = 0;
  tap.connect(mute).connect(context.destination);

  tap.port.onmessage = (event: MessageEvent<{ mic: Float32Array; system: Float32Array }>) => {
    const frame = {
      mic: downsample(event.data.mic, context.sampleRate),
      system: downsample(event.data.system, context.sampleRate),
    };
    callbacks.onLevels?.({ mic: rms(frame.mic), system: rms(frame.system) });
    callbacks.onFrame(frame);
  };

  return {
    systemAudio: systemStream !== null,
    stop() {
      tap.port.onmessage = null;
      tap.disconnect();
      micStream.getTracks().forEach((track) => track.stop());
      systemStream?.getTracks().forEach((track) => track.stop());
      void context.close();
    },
  };
}
