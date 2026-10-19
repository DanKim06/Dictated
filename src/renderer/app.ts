import { renderMarkdown } from "../shared/markdown";
import { dedupeEcho, formatTimestamp, insertSegment } from "../shared/transcript";
import {
  WHISPER_MODELS,
  type Meeting,
  type MeetingListItem,
  type PublicSettings,
  type Speaker,
} from "../shared/types";
import { startCapture, type CaptureSession } from "./audio/capture";
import { DeepgramTranscriber } from "./transcription/deepgram";
import { LocalWhisperTranscriber } from "./transcription/local-whisper";
import type { NewSegment, Transcriber, TranscriberCallbacks } from "./transcription/types";

const api = window.dictated;

function $<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

const ui = {
  list: $<HTMLUListElement>("meeting-list"),
  newMeeting: $<HTMLButtonElement>("new-meeting"),
  openSettings: $<HTMLButtonElement>("open-settings"),
  empty: $<HTMLElement>("empty-state"),
  view: $<HTMLElement>("meeting-view"),
  title: $<HTMLInputElement>("title"),
  appBadge: $<HTMLSpanElement>("app-badge"),
  status: $<HTMLSpanElement>("status"),
  record: $<HTMLButtonElement>("record"),
  remove: $<HTMLButtonElement>("delete"),
  notes: $<HTMLTextAreaElement>("notes"),
  transcript: $<HTMLDivElement>("transcript"),
  summarize: $<HTMLButtonElement>("summarize"),
  summary: $<HTMLDivElement>("summary"),
  levelMe: $<HTMLSpanElement>("level-me"),
  levelThem: $<HTMLSpanElement>("level-them"),
  banner: $<HTMLDivElement>("detect-banner"),
  bannerText: $<HTMLSpanElement>("detect-text"),
  bannerStart: $<HTMLButtonElement>("detect-start"),
  bannerDismiss: $<HTMLButtonElement>("detect-dismiss"),
  dialog: $<HTMLDialogElement>("settings-dialog"),
  form: $<HTMLFormElement>("settings-form"),
  whisperModel: $<HTMLSelectElement>("whisper-model"),
  deepgramKey: $<HTMLInputElement>("deepgram-key"),
  anthropicKey: $<HTMLInputElement>("anthropic-key"),
  ollamaModel: $<HTMLSelectElement>("ollama-model"),
  ollamaHint: $<HTMLParagraphElement>("ollama-hint"),
  autoSummarize: $<HTMLInputElement>("auto-summarize"),
  autoDetect: $<HTMLInputElement>("auto-detect"),
  toast: $<HTMLDivElement>("toast"),
};

interface RecordingSession {
  meetingId: string;
  app: string | null;
  capture: CaptureSession | null;
  transcriber: Transcriber;
  startedAt: number;
  timer: number;
}

let settings: PublicSettings;
let meetings: MeetingListItem[] = [];
let current: Meeting | null = null;
let session: RecordingSession | null = null;
let summarizing = false;
let detectedApp: string | null = null;
let saveTimer: number | null = null;
const partials: Record<Speaker, string> = { me: "", them: "" };

// ---------- helpers ----------

let toastTimer: number | null = null;
function toast(message: string): void {
  ui.toast.textContent = message;
  ui.toast.hidden = false;
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (ui.toast.hidden = true), 6000);
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // ipcRenderer.invoke wraps main-process errors in a prefix users don't need.
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

function newMeeting(app: string | null): Meeting {
  const now = new Date();
  const when = now.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return {
    id: crypto.randomUUID(),
    title: app ? `${app.replace(/ \(browser call\)$/, "")} call · ${when}` : `Meeting · ${when}`,
    app,
    createdAt: now.toISOString(),
    endedAt: null,
    notes: "",
    transcript: [],
    summary: null,
  };
}

async function saveNow(): Promise<void> {
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (current) await api.saveMeeting(current);
}

function scheduleSave(): void {
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    void saveNow().then(refreshList);
  }, 800);
}

// ---------- rendering ----------

async function refreshList(): Promise<void> {
  meetings = await api.listMeetings();
  ui.list.replaceChildren(
    ...meetings.map((m) => {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.textContent = m.title || "Untitled meeting";
      button.setAttribute("aria-current", String(m.id === current?.id));
      const meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = new Date(m.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
        (m.hasSummary ? " · summarized" : "");
      button.append(meta);
      button.addEventListener("click", () => void openMeeting(m.id));
      li.append(button);
      return li;
    }),
  );
}

function renderTranscript(): void {
  if (!current) return;
  const nearBottom = ui.transcript.scrollHeight - ui.transcript.scrollTop - ui.transcript.clientHeight < 40;
  const lines = dedupeEcho(current.transcript).map((s) => line(s.speaker, s.text, s.startMs, false));
  for (const speaker of ["me", "them"] as const) {
    if (partials[speaker]) lines.push(line(speaker, partials[speaker], null, true));
  }
  if (lines.length === 0) {
    const placeholder = document.createElement("p");
    placeholder.className = "placeholder";
    placeholder.textContent = session ? "Listening…" : "No transcript yet. Press Start recording.";
    lines.push(placeholder);
  }
  ui.transcript.replaceChildren(...lines);
  if (nearBottom) ui.transcript.scrollTop = ui.transcript.scrollHeight;
}

function line(speaker: Speaker, text: string, startMs: number | null, partial: boolean): HTMLElement {
  const row = document.createElement("div");
  row.className = `line ${speaker}${partial ? " partial" : ""}`;
  const time = document.createElement("time");
  time.textContent = startMs === null ? "" : formatTimestamp(startMs);
  const p = document.createElement("p");
  const who = document.createElement("span");
  who.className = "who";
  who.title = speaker === "me" ? "Me" : "Them";
  p.append(who, text);
  row.append(time, p);
  return row;
}

function renderSummary(markdown: string | null, streaming = false): void {
  ui.summary.innerHTML = markdown ? renderMarkdown(markdown) : "";
  ui.summary.classList.toggle("streaming", streaming);
}

function renderControls(): void {
  const recordingThis = session !== null && session.meetingId === current?.id;
  ui.record.textContent = recordingThis ? "Stop recording" : "Start recording";
  ui.record.classList.toggle("active", recordingThis);
  ui.record.disabled = session !== null && !recordingThis;
  ui.remove.disabled = recordingThis;
  ui.summarize.disabled = summarizing || recordingThis;
  ui.summarize.textContent = summarizing ? "Summarizing…" : current?.summary ? "Regenerate summary" : "Generate summary";
  if (!recordingThis) {
    ui.levelMe.style.height = "0";
    ui.levelThem.style.height = "0";
  }
}

function renderMeeting(): void {
  ui.empty.hidden = current !== null;
  ui.view.hidden = current === null;
  if (!current) return;
  ui.title.value = current.title;
  ui.appBadge.hidden = !current.app;
  ui.appBadge.textContent = current.app ?? "";
  ui.notes.value = current.notes;
  if (!session || session.meetingId !== current.id) ui.status.textContent = "";
  renderTranscript();
  renderSummary(current.summary);
  renderControls();
}

async function openMeeting(id: string): Promise<void> {
  await saveNow();
  current = await api.getMeeting(id);
  renderMeeting();
  await refreshList();
}

// ---------- recording ----------

function createTranscriber(callbacks: TranscriberCallbacks): Transcriber {
  return settings.transcriptionProvider === "deepgram"
    ? new DeepgramTranscriber(callbacks)
    : new LocalWhisperTranscriber(settings.whisperModel, callbacks);
}

async function startRecording(app: string | null = null): Promise<void> {
  if (session) return;
  hideBanner();
  if (!current || app) {
    await saveNow();
    current = newMeeting(app);
    await api.saveMeeting(current);
    renderMeeting();
    await refreshList();
  }
  const meetingId = current.id;

  const transcriber = createTranscriber({
    onSegment(segment: NewSegment) {
      // Look the meeting up by id: the user may have switched to another one.
      if (current?.id !== meetingId) return void appendToStored(meetingId, segment);
      current.transcript = insertSegment(current.transcript, { ...segment, id: crypto.randomUUID() });
      renderTranscript();
      scheduleSave();
    },
    onPartial(speaker, text) {
      partials[speaker] = text;
      if (current?.id === meetingId) renderTranscript();
    },
    onStatus(message) {
      if (current?.id === meetingId) ui.status.textContent = message;
    },
    onError(error) {
      toast(error.message);
    },
  });

  session = { meetingId, app, capture: null, transcriber, startedAt: Date.now(), timer: 0 };
  renderControls();
  try {
    await transcriber.start();
    session.capture = await startCapture({
      onFrame: (frame) => transcriber.push(frame),
      onLevels: ({ mic, system }) => {
        if (current?.id !== meetingId) return;
        ui.levelMe.style.height = `${Math.min(100, mic * 400)}%`;
        ui.levelThem.style.height = `${Math.min(100, system * 400)}%`;
      },
    });
    if (!session.capture.systemAudio) {
      toast("System audio isn't available, so only your microphone is being recorded. On macOS, allow Screen & System Audio Recording for Dictated.");
    }
    api.setRecording(true);
    const label = ui.status.textContent;
    session.timer = window.setInterval(() => {
      if (session && current?.id === meetingId) {
        ui.status.textContent = `${formatTimestamp(Date.now() - session.startedAt)} · ${label}`;
      }
    }, 1000);
    renderTranscript();
  } catch (error) {
    toast(errorMessage(error));
    await teardown();
  }
}

async function appendToStored(meetingId: string, segment: NewSegment): Promise<void> {
  const stored = await api.getMeeting(meetingId);
  if (!stored) return;
  stored.transcript = insertSegment(stored.transcript, { ...segment, id: crypto.randomUUID() });
  await api.saveMeeting(stored);
}

async function teardown(): Promise<void> {
  if (!session) return;
  const ending = session;
  session = null;
  window.clearInterval(ending.timer);
  ending.capture?.stop();
  try {
    await ending.transcriber.stop();
  } catch (error) {
    toast(errorMessage(error));
  }
  partials.me = "";
  partials.them = "";
  api.setRecording(false);
}

async function stopRecording(): Promise<void> {
  if (!session) return;
  const meetingId = session.meetingId;
  ui.status.textContent = "Finishing transcript…";
  await teardown();

  if (current?.id === meetingId) {
    current.endedAt = new Date().toISOString();
    await saveNow();
    ui.status.textContent = "";
    renderMeeting();
    if (settings.autoSummarize && canSummarize() && current.transcript.length > 0) {
      await summarize();
    }
  }
  await refreshList();
}

// ---------- summaries ----------

/** Local summaries need no key; Ollama problems surface as errors from the main process. */
function canSummarize(): boolean {
  return settings.summaryProvider === "local" || settings.hasAnthropicKey;
}

async function summarize(): Promise<void> {
  if (!current || summarizing) return;
  if (!canSummarize()) {
    toast("Add your Anthropic API key in Settings, or switch summaries to Local (Ollama).");
    return;
  }
  const meetingId = current.id;
  summarizing = true;
  renderControls();
  await saveNow();

  let streamed = "";
  const unsubscribe = api.onSummaryDelta((id, text) => {
    if (id !== meetingId) return;
    streamed += text;
    if (current?.id === meetingId) renderSummary(streamed, true);
  });
  try {
    const summary = await api.generateSummary(meetingId);
    if (current?.id === meetingId) {
      current.summary = summary;
      renderSummary(summary);
    }
    await refreshList();
  } catch (error) {
    toast(errorMessage(error));
    if (current?.id === meetingId) renderSummary(current.summary);
  } finally {
    unsubscribe();
    summarizing = false;
    renderControls();
  }
}

// ---------- meeting detection ----------

function showBanner(app: string): void {
  detectedApp = app;
  ui.bannerText.textContent = `${app} call detected. Want Dictated to take notes?`;
  ui.banner.hidden = false;
}

function hideBanner(): void {
  detectedApp = null;
  ui.banner.hidden = true;
}

api.onMeetingDetected(({ app }) => {
  if (!session) showBanner(app);
});
api.onStartRequested(({ app }) => void startRecording(app));
api.onMeetingEnded(({ app }) => {
  if (detectedApp === app) hideBanner();
  if (session && session.app === app) {
    toast(`${app} call ended. Recording stopped.`);
    void stopRecording();
  }
});

// ---------- settings ----------

function openSettings(): void {
  ui.whisperModel.replaceChildren(
    ...WHISPER_MODELS.map((m) => new Option(m.label, m.id, false, m.id === settings.whisperModel)),
  );
  const provider = ui.form.elements.namedItem("provider") as RadioNodeList;
  provider.value = settings.transcriptionProvider;
  ui.deepgramKey.value = "";
  ui.deepgramKey.placeholder = settings.hasDeepgramKey ? "Saved (type to replace)" : "Not set";
  ui.anthropicKey.value = "";
  ui.anthropicKey.placeholder = settings.hasAnthropicKey ? "Saved (type to replace)" : "sk-ant-…";
  ui.autoSummarize.checked = settings.autoSummarize;
  ui.autoDetect.checked = settings.autoDetectMeetings;
  (ui.form.elements.namedItem("summary-provider") as RadioNodeList).value = settings.summaryProvider;
  void loadOllamaModels();
  ui.dialog.showModal();
}

/** Fills the model picker with what's installed, keeping the saved choice even if Ollama is off. */
async function loadOllamaModels(): Promise<void> {
  const saved = settings.ollamaModel;
  ui.ollamaModel.replaceChildren(new Option(saved, saved, true, true));
  ui.ollamaHint.textContent = "Checking for Ollama…";
  const status = await api.getOllamaStatus();
  // "llama3.2" and "llama3.2:latest" are the same model.
  const isSaved = (name: string) => name === saved || name === `${saved}:latest`;
  const names = status.models.some(isSaved) ? status.models : [saved, ...status.models];
  ui.ollamaModel.replaceChildren(...names.map((n) => new Option(n, n, false, isSaved(n))));

  if (!status.running) {
    ui.ollamaHint.textContent = "Ollama isn't running. Install it from ollama.com, then run: ollama pull llama3.2";
  } else if (!status.models.some(isSaved)) {
    ui.ollamaHint.textContent = `"${saved}" isn't installed yet. Run: ollama pull ${saved}`;
  } else {
    ui.ollamaHint.textContent = `Ollama is running with ${status.models.length} model(s) installed.`;
  }
}

ui.dialog.addEventListener("close", async () => {
  if (ui.dialog.returnValue !== "save") return;
  const provider = (ui.form.elements.namedItem("provider") as RadioNodeList).value;
  const summaryProvider = (ui.form.elements.namedItem("summary-provider") as RadioNodeList).value;
  try {
    settings = await api.updateSettings({
      transcriptionProvider: provider === "deepgram" ? "deepgram" : "local",
      whisperModel: ui.whisperModel.value,
      summaryProvider: summaryProvider === "claude" ? "claude" : "local",
      ollamaModel: ui.ollamaModel.value,
      autoSummarize: ui.autoSummarize.checked,
      autoDetectMeetings: ui.autoDetect.checked,
      ...(ui.deepgramKey.value.trim() ? { deepgramKey: ui.deepgramKey.value } : {}),
      ...(ui.anthropicKey.value.trim() ? { anthropicKey: ui.anthropicKey.value } : {}),
    });
    if (settings.transcriptionProvider === "deepgram" && !settings.hasDeepgramKey) {
      toast("Cloud transcription needs a Deepgram API key.");
    } else if (settings.summaryProvider === "claude" && !settings.hasAnthropicKey) {
      toast("Claude summaries need an Anthropic API key.");
    }
  } catch (error) {
    toast(errorMessage(error));
  }
});

// ---------- wiring ----------

ui.newMeeting.addEventListener("click", async () => {
  await saveNow();
  current = newMeeting(null);
  await api.saveMeeting(current);
  renderMeeting();
  await refreshList();
  ui.title.select();
});
ui.openSettings.addEventListener("click", openSettings);
ui.record.addEventListener("click", () => void (session ? stopRecording() : startRecording()));
ui.summarize.addEventListener("click", () => void summarize());
ui.remove.addEventListener("click", async () => {
  if (!current || session?.meetingId === current.id) return;
  await api.deleteMeeting(current.id);
  current = null;
  await refreshList();
  const next = meetings[0];
  if (next) await openMeeting(next.id);
  else renderMeeting();
});
ui.title.addEventListener("input", () => {
  if (!current) return;
  current.title = ui.title.value;
  scheduleSave();
});
ui.notes.addEventListener("input", () => {
  if (!current) return;
  current.notes = ui.notes.value;
  scheduleSave();
});
ui.bannerStart.addEventListener("click", () => void startRecording(detectedApp));
ui.bannerDismiss.addEventListener("click", hideBanner);
window.addEventListener("beforeunload", () => void saveNow());

async function init(): Promise<void> {
  settings = await api.getSettings();
  await refreshList();
  const latest = meetings[0];
  if (latest) await openMeeting(latest.id);
  else renderMeeting();
  document.body.dataset.ready = "true";
}

void init().catch((error) => toast(errorMessage(error)));
