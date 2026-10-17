import { describe, expect, it } from "vitest";
import { matchMeetingApp, pickMeetingApp } from "../src/main/meeting-detector/known-apps";
import { parseHelperOutput, parseProcessNames } from "../src/main/meeting-detector/mac";
import { END_AFTER_MISSED_POLLS, INITIAL_STATE, step, type DetectorState } from "../src/main/meeting-detector/state";
import { parseMicConsentStore } from "../src/main/meeting-detector/windows";

describe("known apps", () => {
  it("matches macOS bundle ids, including helper processes", () => {
    expect(matchMeetingApp("us.zoom.xos")?.name).toBe("Zoom");
    expect(matchMeetingApp("com.google.Chrome.helper")?.name).toBe("Google Chrome");
  });

  it("matches Windows executables and packaged apps", () => {
    expect(matchMeetingApp("Zoom.exe")?.name).toBe("Zoom");
    expect(matchMeetingApp("msteams_8wekyb3d8bbwe")?.name).toBe("Microsoft Teams");
  });

  it("never treats Dictated itself as a meeting", () => {
    expect(matchMeetingApp("com.github.Electron.helper")).toBeNull();
    expect(matchMeetingApp("dictated.exe")).toBeNull();
  });

  it("prefers a dedicated meeting app over a browser", () => {
    expect(pickMeetingApp(["com.google.Chrome", "us.zoom.xos"])).toBe("Zoom");
    expect(pickMeetingApp(["com.google.Chrome"])).toBe("Google Chrome (browser call)");
    expect(pickMeetingApp(["com.apple.Music"])).toBeNull();
  });
});

describe("detector state machine", () => {
  const run = (observations: (string | null)[]) => {
    let state: DetectorState = INITIAL_STATE;
    const events: string[] = [];
    for (const app of observations) {
      const result = step(state, app);
      state = result.state;
      if (result.event) events.push(`${result.event.type}:${result.event.app}`);
    }
    return events;
  };

  it("announces a call once and ends it after the mic is released", () => {
    const quiet = Array<null>(END_AFTER_MISSED_POLLS).fill(null);
    expect(run(["Zoom", "Zoom", "Zoom", ...quiet])).toEqual(["detected:Zoom", "ended:Zoom"]);
  });

  it("tolerates a brief gap in mic use", () => {
    expect(run(["Zoom", null, "Zoom", null])).toEqual(["detected:Zoom"]);
  });
});

describe("Windows microphone consent store", () => {
  const output = [
    "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone",
    "    Value    REG_SZ    Allow",
    "",
    "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\MSTeams_8wekyb3d8bbwe",
    "    LastUsedTimeStart    REG_QWORD    0x1db0c7c4a1b2c3d",
    "    LastUsedTimeStop    REG_QWORD    0x1db0c7c4a1b9999",
    "",
    "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\NonPackaged\\C:#Users#me#AppData#Roaming#Zoom#bin#Zoom.exe",
    "    LastUsedTimeStart    REG_QWORD    0x1db0c7c4a1b2c3d",
    "    LastUsedTimeStop    REG_QWORD    0x0",
    "",
    "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\NonPackaged\\C:#Program Files#Never#Used.exe",
    "    LastUsedTimeStart    REG_QWORD    0x0",
    "    LastUsedTimeStop    REG_QWORD    0x0",
  ].join("\r\n");

  it("returns only apps using the mic right now", () => {
    expect(parseMicConsentStore(output)).toEqual(["zoom.exe"]);
  });
});

describe("macOS helper output", () => {
  it("parses per-process mic usage", () => {
    const result = parseHelperOutput('{"micInUse":true,"perProcess":true,"processes":[{"bundleId":"us.zoom.xos","pid":42}]}');
    expect(result.processes).toEqual([{ bundleId: "us.zoom.xos", pid: 42 }]);
  });

  it("extracts process names from ps output", () => {
    expect(parseProcessNames("/Applications/zoom.us.app/Contents/MacOS/zoom.us\n/usr/sbin/cfprefsd\n")).toEqual([
      "zoom.us",
      "cfprefsd",
    ]);
  });
});
