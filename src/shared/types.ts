// Types shared by the main process, the preload bridge and the renderer.

export type Speaker = "me" | "them";

export interface TranscriptSegment {
  id: string;
  speaker: Speaker;
  text: string;
  /** Milliseconds since the recording started. */
  startMs: number;
  endMs: number;
}

export interface Meeting {
  id: string;
  title: string;
  /** Meeting app that triggered auto-detection (e.g. "Zoom"), if any. */
  app: string | null;
  createdAt: string;
  endedAt: string | null;
  notes: string;
  transcript: TranscriptSegment[];
  summary: string | null;
}

export interface MeetingListItem {
  id: string;
  title: string;
  app: string | null;
  createdAt: string;
  hasSummary: boolean;
}

export type TranscriptionProvider = "local" | "deepgram";

export interface Settings {
  transcriptionProvider: TranscriptionProvider;
  whisperModel: string;
  autoDetectMeetings: boolean;
  autoSummarize: boolean;
}

/** Settings as the renderer sees them: secrets are never sent, only whether they exist. */
export interface PublicSettings extends Settings {
  hasDeepgramKey: boolean;
  hasAnthropicKey: boolean;
}

/** A secret set to `null` is removed; `undefined` leaves it unchanged. */
export interface SettingsUpdate extends Partial<Settings> {
  deepgramKey?: string | null;
  anthropicKey?: string | null;
}

export interface DeepgramAuth {
  /** "bearer" for a short-lived token, "token" when falling back to the API key. */
  scheme: "bearer" | "token";
  credential: string;
}

export interface DetectedMeeting {
  app: string;
}

export const DEFAULT_SETTINGS: Settings = {
  transcriptionProvider: "local",
  whisperModel: "onnx-community/whisper-base.en",
  autoDetectMeetings: true,
  autoSummarize: true,
};

export const WHISPER_MODELS = [
  { id: "onnx-community/whisper-tiny.en", label: "Tiny (fastest, ~40 MB)" },
  { id: "onnx-community/whisper-base.en", label: "Base (balanced, ~80 MB)" },
  { id: "onnx-community/whisper-small.en", label: "Small (most accurate, ~250 MB)" },
] as const;

/** The API the preload script exposes on `window.dictated`. */
export interface DictatedApi {
  getSettings(): Promise<PublicSettings>;
  updateSettings(update: SettingsUpdate): Promise<PublicSettings>;

  listMeetings(): Promise<MeetingListItem[]>;
  getMeeting(id: string): Promise<Meeting | null>;
  saveMeeting(meeting: Meeting): Promise<void>;
  deleteMeeting(id: string): Promise<void>;

  /** Streams the summary through `onSummaryDelta` and resolves with the full text. */
  generateSummary(meetingId: string): Promise<string>;
  onSummaryDelta(listener: (meetingId: string, text: string) => void): () => void;

  getDeepgramAuth(): Promise<DeepgramAuth>;
  setRecording(recording: boolean): void;

  onMeetingDetected(listener: (meeting: DetectedMeeting) => void): () => void;
  onMeetingEnded(listener: (meeting: DetectedMeeting) => void): () => void;
  onStartRequested(listener: (meeting: DetectedMeeting) => void): () => void;
}
