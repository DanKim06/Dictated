import fs from "node:fs";
import path from "node:path";
import type { Meeting, MeetingListItem } from "../shared/types";

// Meeting ids become file names, so only allow a safe character set. This
// stops a crafted id like "../../settings" from escaping the meetings folder.
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export class MeetingStore {
  constructor(private readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  list(): MeetingListItem[] {
    return fs
      .readdirSync(this.dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => this.read(path.join(this.dir, name)))
      .filter((m): m is Meeting => m !== null)
      .map((m) => ({
        id: m.id,
        title: m.title,
        app: m.app,
        createdAt: m.createdAt,
        hasSummary: Boolean(m.summary),
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): Meeting | null {
    return this.read(this.fileFor(id));
  }

  save(meeting: Meeting): void {
    const file = this.fileFor(meeting.id);
    // Write to a temp file and rename, so a crash mid-write can't corrupt notes.
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(meeting, null, 2));
    fs.renameSync(tmp, file);
  }

  delete(id: string): void {
    fs.rmSync(this.fileFor(id), { force: true });
  }

  private fileFor(id: string): string {
    if (!ID_PATTERN.test(id)) throw new Error(`Invalid meeting id: ${id}`);
    return path.join(this.dir, `${id}.json`);
  }

  private read(file: string): Meeting | null {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as Meeting;
    } catch {
      return null;
    }
  }
}
