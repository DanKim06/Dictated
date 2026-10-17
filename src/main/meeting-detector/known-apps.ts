// Maps the identifiers each OS reports for "who is using the microphone"
// (macOS bundle ids / process names, Windows exe names / package names) to a
// friendly meeting-app name.

export interface MeetingApp {
  name: string;
  /** True for general-purpose browsers, where the call could be Meet, Zoom web, etc. */
  browser: boolean;
  macBundleIds: string[];
  macProcessNames: string[];
  windowsNames: string[];
}

export const MEETING_APPS: MeetingApp[] = [
  { name: "Zoom", browser: false, macBundleIds: ["us.zoom.xos"], macProcessNames: ["zoom.us"], windowsNames: ["zoom.exe", "zoomhybridconf.exe"] },
  { name: "Microsoft Teams", browser: false, macBundleIds: ["com.microsoft.teams2", "com.microsoft.teams"], macProcessNames: ["MSTeams", "Microsoft Teams"], windowsNames: ["ms-teams.exe", "teams.exe", "msteams_8wekyb3d8bbwe"] },
  { name: "Webex", browser: false, macBundleIds: ["com.cisco.webexmeetingsapp", "Cisco-Systems.Spark"], macProcessNames: ["Webex", "Cisco Webex Meetings"], windowsNames: ["webex.exe", "ciscocollabhost.exe", "atmgr.exe"] },
  { name: "Slack", browser: false, macBundleIds: ["com.tinyspeck.slackmacgap"], macProcessNames: ["Slack"], windowsNames: ["slack.exe"] },
  { name: "Discord", browser: false, macBundleIds: ["com.hnc.Discord"], macProcessNames: ["Discord"], windowsNames: ["discord.exe"] },
  { name: "FaceTime", browser: false, macBundleIds: ["com.apple.FaceTime"], macProcessNames: ["FaceTime"], windowsNames: [] },
  { name: "Google Chrome", browser: true, macBundleIds: ["com.google.Chrome"], macProcessNames: ["Google Chrome"], windowsNames: ["chrome.exe"] },
  { name: "Microsoft Edge", browser: true, macBundleIds: ["com.microsoft.edgemac"], macProcessNames: ["Microsoft Edge"], windowsNames: ["msedge.exe"] },
  { name: "Arc", browser: true, macBundleIds: ["company.thebrowser.Browser"], macProcessNames: ["Arc"], windowsNames: ["arc.exe"] },
  { name: "Brave", browser: true, macBundleIds: ["com.brave.Browser"], macProcessNames: ["Brave Browser"], windowsNames: ["brave.exe"] },
  { name: "Firefox", browser: true, macBundleIds: ["org.mozilla.firefox"], macProcessNames: ["firefox"], windowsNames: ["firefox.exe"] },
  { name: "Safari", browser: true, macBundleIds: ["com.apple.Safari", "com.apple.WebKit.GPU"], macProcessNames: ["Safari"], windowsNames: [] },
];

/** Our own audio capture must never count as a meeting. */
export const SELF_IDENTIFIERS = ["com.github.electron", "com.dictated.app", "electron.exe", "dictated.exe"];

function normalize(id: string): string {
  return id.trim().toLowerCase();
}

/**
 * Finds the meeting app behind an identifier. Matches by prefix so helper
 * processes ("com.google.Chrome.helper") resolve to their parent app.
 */
export function matchMeetingApp(identifier: string): MeetingApp | null {
  const id = normalize(identifier);
  if (!id || SELF_IDENTIFIERS.some((self) => id.startsWith(self))) return null;
  for (const app of MEETING_APPS) {
    const ids = [...app.macBundleIds, ...app.macProcessNames, ...app.windowsNames].map(normalize);
    if (ids.some((known) => id === known || id.startsWith(`${known}.`))) return app;
  }
  return null;
}

/**
 * Picks the most likely meeting app among everything using the mic.
 * Dedicated apps win over browsers, since a browser may just be dictation.
 */
export function pickMeetingApp(identifiers: readonly string[]): string | null {
  const apps = identifiers.map(matchMeetingApp).filter((a): a is MeetingApp => a !== null);
  const dedicated = apps.find((a) => !a.browser);
  if (dedicated) return dedicated.name;
  const browser = apps[0];
  return browser ? `${browser.name} (browser call)` : null;
}
