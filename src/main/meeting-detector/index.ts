import { EventEmitter } from "node:events";
import { pickMeetingApp } from "./known-apps";
import { getMicUsersMac } from "./mac";
import { INITIAL_STATE, step, type DetectorState } from "./state";
import { getMicUsersWindows } from "./windows";

export interface MeetingDetectorEvents {
  detected: [app: string];
  ended: [app: string];
}

/** Polls which apps are using the microphone and emits when a call starts or ends. */
export class MeetingDetector extends EventEmitter<MeetingDetectorEvents> {
  private state: DetectorState = INITIAL_STATE;
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  private warned = false;

  constructor(
    private readonly options: { macHelperPath: string; intervalMs?: number },
  ) {
    super();
  }

  static isSupported(): boolean {
    return process.platform === "darwin" || process.platform === "win32";
  }

  start(): void {
    if (this.timer || !MeetingDetector.isSupported()) return;
    this.timer = setInterval(() => void this.poll(), this.options.intervalMs ?? 3000);
    void this.poll();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.state = INITIAL_STATE;
  }

  private async poll(): Promise<void> {
    if (this.polling) return; // a slow probe must not stack up
    this.polling = true;
    try {
      const users =
        process.platform === "darwin"
          ? await getMicUsersMac(this.options.macHelperPath)
          : await getMicUsersWindows();
      const { state, event } = step(this.state, pickMeetingApp(users));
      this.state = state;
      if (event) this.emit(event.type, event.app);
    } catch (error) {
      if (!this.warned) {
        console.warn("[meeting-detector] probe failed; auto-detection paused:", error);
        this.warned = true;
      }
    } finally {
      this.polling = false;
    }
  }
}
