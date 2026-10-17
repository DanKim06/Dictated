// The only bridge between the sandboxed UI and the main process. The renderer
// gets these functions on `window.dictated` and nothing else from Node.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { IPC } from "../shared/ipc";
import type { DetectedMeeting, DictatedApi } from "../shared/types";

function subscribe<Args extends unknown[]>(
  channel: string,
  listener: (...args: Args) => void,
): () => void {
  const handler = (_event: IpcRendererEvent, ...args: unknown[]) => listener(...(args as Args));
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: DictatedApi = {
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  updateSettings: (update) => ipcRenderer.invoke(IPC.updateSettings, update),

  listMeetings: () => ipcRenderer.invoke(IPC.listMeetings),
  getMeeting: (id) => ipcRenderer.invoke(IPC.getMeeting, id),
  saveMeeting: (meeting) => ipcRenderer.invoke(IPC.saveMeeting, meeting),
  deleteMeeting: (id) => ipcRenderer.invoke(IPC.deleteMeeting, id),

  generateSummary: (meetingId) => ipcRenderer.invoke(IPC.generateSummary, meetingId),
  onSummaryDelta: (listener) => subscribe<[string, string]>(IPC.summaryDelta, listener),

  getDeepgramAuth: () => ipcRenderer.invoke(IPC.deepgramAuth),
  setRecording: (recording) => ipcRenderer.send(IPC.setRecording, recording),

  onMeetingDetected: (listener) => subscribe<[DetectedMeeting]>(IPC.meetingDetected, listener),
  onMeetingEnded: (listener) => subscribe<[DetectedMeeting]>(IPC.meetingEnded, listener),
  onStartRequested: (listener) => subscribe<[DetectedMeeting]>(IPC.startRequested, listener),
};

contextBridge.exposeInMainWorld("dictated", api);
