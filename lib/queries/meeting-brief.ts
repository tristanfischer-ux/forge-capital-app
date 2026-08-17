import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface MeetingCorrespondence {
  id: string;
  threadId?: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
}

export interface MeetingBriefFile {
  partner_id: number | null;
  firm_id: number | null;
  firm_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  campaign_partner_id: string | null;
  correspondence: MeetingCorrespondence[];
  brief: {
    who?: string;
    firm?: string;
    why_this_call?: string;
    focus?: string[];
    raise?: string;
    email_story?: string;
  };
  generated_at: string;
}

export function loadMeetingBriefs(): Record<string, MeetingBriefFile> {
  const file = join(process.cwd(), "data/meeting-briefs.json");
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, MeetingBriefFile>;
  } catch {
    return {};
  }
}

export function loadMeetingNotes(): Record<string, { text: string; updated_at: string }> {
  const file = join(process.cwd(), "data/meeting-notes.json");
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<
      string,
      { text: string; updated_at: string }
    >;
  } catch {
    return {};
  }
}

export function saveMeetingNote(id: string, text: string) {
  const file = join(process.cwd(), "data/meeting-notes.json");
  mkdirSync(join(process.cwd(), "data"), { recursive: true });
  const all = loadMeetingNotes();
  all[id] = { text, updated_at: new Date().toISOString() };
  writeFileSync(file, JSON.stringify(all, null, 2));
}
