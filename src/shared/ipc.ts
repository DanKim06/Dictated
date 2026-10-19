// IPC channel names, kept in one place so main and preload can't drift apart.
export const IPC = {
  getSettings: "settings:get",
  updateSettings: "settings:update",
  listMeetings: "meetings:list",
  getMeeting: "meetings:get",
  saveMeeting: "meetings:save",
  deleteMeeting: "meetings:delete",
  generateSummary: "summary:generate",
  summaryDelta: "summary:delta",
  ollamaStatus: "ollama:status",
  deepgramAuth: "deepgram:auth",
  setRecording: "recording:set",
  meetingDetected: "meeting:detected",
  meetingEnded: "meeting:ended",
  startRequested: "meeting:start-requested",
} as const;
