// Runs Whisper locally (Transformers.js + ONNX Runtime) off the UI thread.
// Audio never leaves the machine; only the model weights are downloaded once
// from Hugging Face and then served from the browser cache.
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

export type WorkerRequest =
  | { type: "load"; model: string }
  | { type: "transcribe"; id: number; audio: Float32Array };

export type WorkerResponse =
  | { type: "ready"; device: string }
  | { type: "progress"; message: string }
  | { type: "result"; id: number; text: string }
  | { type: "error"; id?: number; message: string };

env.allowLocalModels = false;
// Use the ONNX Runtime files bundled with the app instead of a CDN.
const wasm = env.backends.onnx.wasm;
if (wasm) {
  wasm.wasmPaths = {
    mjs: new URL("ort/ort-wasm-simd-threaded.asyncify.mjs", self.location.href).href,
    wasm: new URL("ort/ort-wasm-simd-threaded.asyncify.wasm", self.location.href).href,
  };
}

let asr: AutomaticSpeechRecognitionPipeline | null = null;

function reply(message: WorkerResponse): void {
  self.postMessage(message);
}

async function load(model: string): Promise<void> {
  const progress_callback = (info: { status?: string; file?: string; progress?: number }) => {
    if (info.status === "progress" && info.file && typeof info.progress === "number") {
      reply({ type: "progress", message: `Downloading ${info.file.split("/").pop()} ${Math.round(info.progress)}%` });
    }
  };
  const hasWebGpu = "gpu" in navigator;
  if (hasWebGpu) {
    try {
      asr = await pipeline("automatic-speech-recognition", model, {
        device: "webgpu",
        dtype: { encoder_model: "fp32", decoder_model_merged: "q4" },
        progress_callback,
      });
      reply({ type: "ready", device: "webgpu" });
      return;
    } catch (error) {
      reply({ type: "progress", message: `WebGPU unavailable (${String(error)}); using CPU` });
    }
  }
  asr = await pipeline("automatic-speech-recognition", model, { device: "wasm", dtype: "q8", progress_callback });
  reply({ type: "ready", device: "wasm" });
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === "load") {
      await load(request.model);
    } else if (request.type === "transcribe") {
      if (!asr) throw new Error("Model not loaded");
      const output = await asr(request.audio);
      const text = Array.isArray(output) ? output.map((o) => o.text).join(" ") : output.text;
      reply({ type: "result", id: request.id, text });
    }
  } catch (error) {
    reply({
      type: "error",
      id: request.type === "transcribe" ? request.id : undefined,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
