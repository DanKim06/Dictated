import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  net,
  Notification,
  protocol,
  safeStorage,
  session,
  shell,
  systemPreferences,
} from "electron";
import { IPC } from "../shared/ipc";
import type { DetectedMeeting, Meeting, SettingsUpdate } from "../shared/types";
import { getDeepgramAuth } from "./deepgram-auth";
import { MeetingDetector } from "./meeting-detector";
import { getOllamaStatus, summarizeWithOllama } from "./ollama";
import { SettingsStore, type SecretCodec } from "./settings";
import { MeetingStore } from "./storage";
import { summarizeMeeting } from "./summarizer";

const SMOKE_TEST = process.argv.includes("--smoke");
const DEV = process.argv.includes("--dev");
const RENDERER_DIR = path.join(__dirname, "../renderer");
const APP_ORIGIN = "app://dictated";

// System-audio loopback for getDisplayMedia on macOS. Windows supports
// loopback natively; on macOS Chromium needs these features enabled (Core
// Audio taps on 14.2+, ScreenCaptureKit audio on older versions).
app.commandLine.appendSwitch(
  "enable-features",
  "MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride,MacCatapLoopbackAudioForScreenShare",
);

// Serve the UI from a privileged custom scheme rather than file://, so it gets
// a real origin (needed for the Cache API that stores Whisper models) and we
// can send cross-origin isolation headers (needed for multithreaded WASM).
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let mainWindow: BrowserWindow | null = null;
let recording = false;
let settings: SettingsStore;
let meetings: MeetingStore;
let detector: MeetingDetector | null = null;

const keychainCodec: SecretCodec = {
  encrypt: (plain) =>
    safeStorage.isEncryptionAvailable()
      ? `enc:${safeStorage.encryptString(plain).toString("base64")}`
      : `raw:${Buffer.from(plain).toString("base64")}`,
  decrypt: (encoded) =>
    encoded.startsWith("enc:")
      ? safeStorage.decryptString(Buffer.from(encoded.slice(4), "base64"))
      : Buffer.from(encoded.slice(4), "base64").toString("utf8"),
};

function serveRenderer(): void {
  protocol.handle("app", async (request) => {
    const { pathname } = new URL(request.url);
    const relative = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
    const file = path.normalize(path.join(RENDERER_DIR, relative));
    if (!file.startsWith(RENDERER_DIR + path.sep)) {
      return new Response("Not found", { status: 404 });
    }
    const response = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(response.headers);
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
    headers.set("Cross-Origin-Embedder-Policy", "credentialless");
    return new Response(response.body, { status: response.status, headers });
  });
}

function configureMediaAccess(): void {
  const ses = session.defaultSession;
  const isApp = (origin: string | undefined) => origin?.startsWith(APP_ORIGIN) ?? false;

  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ["media", "display-capture", "notifications"].includes(permission);
    callback(allowed && isApp(webContents.getURL()));
  });
  ses.setPermissionCheckHandler((_webContents, permission, origin) =>
    ["media", "display-capture", "notifications"].includes(permission) && isApp(origin),
  );

  // getDisplayMedia() in the renderer lands here. We hand back the primary
  // screen plus loopback audio without showing a picker; the renderer drops
  // the video track immediately and keeps only system audio.
  ses.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const [screen] = await desktopCapturer.getSources({ types: ["screen"] });
        if (!screen) return callback({});
        callback({ video: screen, audio: "loopback" });
      } catch (error) {
        console.error("[capture] could not start system audio capture:", error);
        callback({});
      }
    },
    { useSystemPicker: false },
  );
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 760,
    minHeight: 520,
    title: "Dictated",
    show: !SMOKE_TEST,
    backgroundColor: "#f7f6f3",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  // Open external links in the browser, never inside the app window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(APP_ORIGIN)) event.preventDefault();
  });
  void window.loadURL(`${APP_ORIGIN}/index.html`);
  if (DEV) window.webContents.openDevTools({ mode: "detach" });
  window.on("closed", () => {
    mainWindow = null;
  });
  return window;
}

function showWindow(): BrowserWindow {
  if (!mainWindow) mainWindow = createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  return mainWindow;
}

function send(channel: string, payload: DetectedMeeting): void {
  mainWindow?.webContents.send(channel, payload);
}

function configureDetector(): void {
  const enabled = settings.get().autoDetectMeetings && MeetingDetector.isSupported();
  if (!enabled) {
    detector?.stop();
    return;
  }
  if (!detector) {
    detector = new MeetingDetector({ macHelperPath: path.join(__dirname, "../bin/mic-monitor") });
    detector.on("detected", (appName) => {
      if (recording) return;
      send(IPC.meetingDetected, { app: appName });
      if (Notification.isSupported()) {
        const notification = new Notification({
          title: `${appName} call detected`,
          body: "Click to start transcribing with Dictated.",
        });
        notification.on("click", () => {
          showWindow();
          send(IPC.startRequested, { app: appName });
        });
        notification.show();
      }
    });
    detector.on("ended", (appName) => send(IPC.meetingEnded, { app: appName }));
  }
  detector.start();
}

function registerIpc(): void {
  ipcMain.handle(IPC.getSettings, () => settings.getPublic());
  ipcMain.handle(IPC.updateSettings, (_event, update: SettingsUpdate) => {
    const result = settings.update(update);
    configureDetector();
    return result;
  });

  ipcMain.handle(IPC.listMeetings, () => meetings.list());
  ipcMain.handle(IPC.getMeeting, (_event, id: string) => meetings.get(id));
  ipcMain.handle(IPC.saveMeeting, (_event, meeting: Meeting) => meetings.save(meeting));
  ipcMain.handle(IPC.deleteMeeting, (_event, id: string) => meetings.delete(id));

  ipcMain.handle(IPC.generateSummary, async (event, meetingId: string) => {
    const meeting = meetings.get(meetingId);
    if (!meeting) throw new Error("Meeting not found.");
    const onDelta = (text: string) => event.sender.send(IPC.summaryDelta, meetingId, text);

    const { summaryProvider, ollamaModel } = settings.get();
    let summary: string;
    if (summaryProvider === "claude") {
      const apiKey = settings.getSecret("anthropicKey");
      if (!apiKey) throw new Error("Add your Anthropic API key in Settings, or switch summaries to Local (Ollama).");
      summary = await summarizeMeeting(meeting, apiKey, onDelta);
    } else {
      summary = await summarizeWithOllama(meeting, ollamaModel, onDelta);
    }
    // Re-read so notes typed while the summary streamed aren't overwritten.
    const latest = meetings.get(meetingId) ?? meeting;
    meetings.save({ ...latest, summary });
    return summary;
  });

  ipcMain.handle(IPC.ollamaStatus, () => getOllamaStatus());

  ipcMain.handle(IPC.deepgramAuth, async () => {
    const apiKey = settings.getSecret("deepgramKey");
    if (!apiKey) throw new Error("Add your Deepgram API key in Settings, or switch to on-device transcription.");
    return getDeepgramAuth(apiKey);
  });

  ipcMain.on(IPC.setRecording, (_event, value: boolean) => {
    recording = value;
  });
}

async function requestMicrophoneAccess(): Promise<void> {
  if (process.platform !== "darwin") return;
  if (systemPreferences.getMediaAccessStatus("microphone") === "not-determined") {
    await systemPreferences.askForMediaAccess("microphone");
  }
}

function runSmokeTest(window: BrowserWindow): void {
  const errors: string[] = [];
  window.webContents.on("console-message", (event) => {
    if (event.level === "error") errors.push(event.message);
  });
  window.webContents.on("did-fail-load", (_event, code, description) => {
    errors.push(`did-fail-load ${code}: ${description}`);
  });
  window.webContents.once("did-finish-load", () => {
    setTimeout(async () => {
      const ready = await window.webContents
        .executeJavaScript("document.body.dataset.ready === 'true'")
        .catch(() => false);
      const whisper = process.argv.includes("--smoke-whisper")
        ? await window.webContents.executeJavaScript(WHISPER_PROBE).catch((e: Error) => `error: ${e.message}`)
        : null;
      if (whisper !== null) console.log("Whisper probe:", whisper);
      const whisperOk = whisper === null || (typeof whisper === "string" && whisper.startsWith("ready"));
      // Calls Ollama through the real preload bridge and IPC handler.
      const ollama = process.argv.includes("--smoke-ollama")
        ? await window.webContents.executeJavaScript("window.dictated.getOllamaStatus()").catch(() => null)
        : undefined;
      if (ollama !== undefined) console.log("Ollama probe:", JSON.stringify(ollama));
      const ollamaOk = ollama === undefined || (ollama?.running === true && ollama.models.length > 0);
      if (ready && whisperOk && ollamaOk && errors.length === 0) {
        console.log("SMOKE OK");
        app.exit(0);
      } else {
        console.error("SMOKE FAIL", { ready, whisper, ollama, errors });
        app.exit(1);
      }
    }, 2500);
  });
}

// Loads the smallest Whisper model in the real worker and transcribes one
// second of silence, proving the on-device pipeline works end to end.
const WHISPER_PROBE = `new Promise((resolve) => {
  const worker = new Worker("whisper.worker.js", { type: "module" });
  let device = "";
  worker.onerror = (e) => resolve("error: " + e.message);
  worker.onmessage = ({ data }) => {
    if (data.type === "ready") {
      device = data.device;
      worker.postMessage({ type: "transcribe", id: 1, audio: new Float32Array(16000) });
    } else if (data.type === "result") {
      resolve("ready on " + device + ", text=" + JSON.stringify(data.text));
    } else if (data.type === "error") {
      resolve("error: " + data.message);
    }
  };
  worker.postMessage({ type: "load", model: "onnx-community/whisper-tiny.en" });
})`;

if (!SMOKE_TEST && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());

  void app.whenReady().then(async () => {
    const userData = SMOKE_TEST ? path.join(app.getPath("temp"), "dictated-smoke") : app.getPath("userData");
    settings = new SettingsStore(userData, keychainCodec);
    meetings = new MeetingStore(path.join(userData, "meetings"));

    serveRenderer();
    configureMediaAccess();
    registerIpc();
    mainWindow = createWindow();

    if (SMOKE_TEST) {
      runSmokeTest(mainWindow);
      return;
    }
    await requestMicrophoneAccess();
    configureDetector();
  });

  app.on("activate", () => showWindow());
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
